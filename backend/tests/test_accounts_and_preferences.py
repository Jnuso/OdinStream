"""Unit tests for backend/app/accounts.py and backend/app/preferences.py."""

from __future__ import annotations

import time
import unittest
from unittest.mock import MagicMock, patch
from uuid import uuid4

import jwt
import psycopg
from fastapi.testclient import TestClient

from app.accounts import preference_store
from app.errors import APIError
from app.main import app
from app.preferences import (
    FAVORITE_GENRES,
    STREAMING_SERVICES,
    MemoryPreferenceStore,
    normalize_choices,
)
from app.settings import Settings, get_settings

TEST_SECRET = "accounts-preferences-test-secret-over-32-bytes"
SUPABASE_URL = "https://example.supabase.co"


def _token(user_id: str) -> str:
    return jwt.encode(
        {
            "sub": user_id,
            "email": "user@example.test",
            "aud": "authenticated",
            "iss": f"{SUPABASE_URL}/auth/v1",
            "exp": int(time.time()) + 600,
            "role": "authenticated",
        },
        TEST_SECRET,
        algorithm="HS256",
    )


class NormalizeChoicesAndMemoryStoreTest(unittest.TestCase):
    def test_normalize_choices_deduplicates_and_preserves_order(self) -> None:
        result = normalize_choices(["Drama", "Comedy", "Drama"], FAVORITE_GENRES, "Favorite genres")
        self.assertEqual(result, ["Drama", "Comedy"])
        self.assertEqual(normalize_choices([], STREAMING_SERVICES, "Streaming services"), [])

    def test_normalize_choices_rejects_invalid_types_and_unknown_values(self) -> None:
        for bad_input in ("Drama", None, 123, {"Drama": True}, [123], ["NotAGenre"]):
            with self.subTest(bad_input=bad_input):
                with self.assertRaises(APIError) as ctx:
                    normalize_choices(bad_input, FAVORITE_GENRES, "Favorite genres")
                self.assertEqual(ctx.exception.status_code, 422)
                self.assertEqual(ctx.exception.error, "invalid_preferences")

    def test_memory_preference_store_isolates_users_and_copies_lists(self) -> None:
        store = MemoryPreferenceStore()
        user_a, user_b = str(uuid4()), str(uuid4())
        self.assertEqual(store.get(user_a), {"favorite_genres": [], "streaming_services": []})

        saved = store.save(user_a, ["Action"], ["Netflix"])
        saved["favorite_genres"].append("Mutated")
        self.assertEqual(store.get(user_a), {"favorite_genres": ["Action"], "streaming_services": ["Netflix"]})
        self.assertEqual(store.get(user_b), {"favorite_genres": [], "streaming_services": []})


class PreferencesRoutesTest(unittest.TestCase):
    def setUp(self) -> None:
        self.user_a = str(uuid4())
        self.settings = Settings(SUPABASE_URL, TEST_SECRET, "", ())
        self.store = MemoryPreferenceStore()
        app.dependency_overrides[get_settings] = lambda: self.settings
        app.dependency_overrides[preference_store] = lambda: self.store
        self.client = TestClient(app, client=(self.id(), 50000))
        self.headers = {"Authorization": f"Bearer {_token(self.user_a)}"}

    def tearDown(self) -> None:
        app.dependency_overrides.clear()

    def test_preferences_require_auth_and_round_trip(self) -> None:
        self.assertEqual(self.client.get("/api/me/preferences").status_code, 401)
        self.assertEqual(self.client.get("/api/me/preferences", headers=self.headers).json(), {"favorite_genres": [], "streaming_services": []})

        res = self.client.put(
            "/api/me/preferences",
            headers=self.headers,
            json={"favorite_genres": ["Drama", "Drama", "Thriller"], "streaming_services": ["Netflix", "Max"]},
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json(), {"favorite_genres": ["Drama", "Thriller"], "streaming_services": ["Netflix", "Max"]})
        self.assertEqual(self.client.get("/api/me/preferences", headers=self.headers).json(), res.json())

    def test_preferences_reject_invalid_payloads_and_unconfigured_db(self) -> None:
        for body in (["Drama"], {"favorite_genres": ["Unknown"], "streaming_services": []}, {"favorite_genres": [], "streaming_services": ["PirateSite"]}):
            with self.subTest(body=body):
                self.assertEqual(self.client.put("/api/me/preferences", headers=self.headers, json=body).status_code, 422)

        app.dependency_overrides.pop(preference_store, None)
        res = self.client.get("/api/me/preferences", headers=self.headers)
        self.assertEqual(res.status_code, 503)
        self.assertEqual(res.json()["error"], "preferences_unavailable")


class SetupRoutesTest(unittest.TestCase):
    def setUp(self) -> None:
        self.user_a = str(uuid4())
        self.settings = Settings(SUPABASE_URL, TEST_SECRET, "postgresql://odin_api_login:pw@localhost:5432/postgres", ())
        app.dependency_overrides[get_settings] = lambda: self.settings
        self.client = TestClient(app, client=(self.id(), 50000))
        self.headers = {"Authorization": f"Bearer {_token(self.user_a)}"}

    def tearDown(self) -> None:
        app.dependency_overrides.clear()

    def test_get_setup_fails_closed_when_db_unconfigured(self) -> None:
        app.dependency_overrides[get_settings] = lambda: Settings(SUPABASE_URL, TEST_SECRET, "", ())
        res = self.client.get("/api/me/setup", headers=self.headers)
        self.assertEqual(res.status_code, 503)
        self.assertEqual(res.json()["error"], "account_unavailable")

    def test_put_setup_validates_username_and_saves_with_preserved_case(self) -> None:
        bad = self.client.put(
            "/api/me/setup",
            headers=self.headers,
            json={"username": "bad name!", "visibility": "private"},
        )
        self.assertEqual(bad.status_code, 422)
        self.assertEqual(bad.json()["error"], "invalid_username")

        conn = MagicMock()
        conn.__enter__.return_value = conn
        conn.execute.return_value.fetchone.return_value = (self.user_a,)
        with patch("app.accounts.user_connection", return_value=conn):
            res = self.client.put(
                "/api/me/setup",
                headers=self.headers,
                json={
                    "username": "  Jack_01.Ok  ",
                    "visibility": "public",
                    "favorite_genres": ["Comedy", "Comedy"],
                    "streaming_services": ["Hulu"],
                },
            )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json(), {"setup_complete": True, "username": "Jack_01.Ok", "visibility": "public"})

    def test_put_setup_handles_already_complete_duplicate_handle_and_db_error(self) -> None:
        conn = MagicMock()
        conn.__enter__.return_value = conn
        conn.execute.return_value.fetchone.return_value = None
        with patch("app.accounts.user_connection", return_value=conn):
            already = self.client.put("/api/me/setup", headers=self.headers, json={"username": "Valid_1", "visibility": "private"})
        self.assertEqual(already.status_code, 409)
        self.assertEqual(already.json()["error"], "setup_already_complete")

        with patch("app.accounts.user_connection", side_effect=psycopg.errors.UniqueViolation("dup")):
            dup = self.client.put("/api/me/setup", headers=self.headers, json={"username": "Valid_1", "visibility": "private"})
        self.assertEqual(dup.status_code, 409)
        self.assertEqual(dup.json()["error"], "duplicate_handle")

        with patch("app.accounts.user_connection", side_effect=psycopg.OperationalError("down")):
            down = self.client.put("/api/me/setup", headers=self.headers, json={"username": "Valid_1", "visibility": "private"})
        self.assertEqual(down.status_code, 503)
        self.assertEqual(down.json()["error"], "account_unavailable")

    def test_setup_persists_verified_titles_and_people_on_same_connection(self) -> None:
        conn = MagicMock()
        conn.__enter__.return_value = conn
        conn.execute.return_value.fetchone.return_value = (self.user_a,)
        body = {
            "username": "New_user", "visibility": "private",
            "favorite_titles": [{"media_type": "movie", "id": 10}, {"media_type": "tv", "id": 10},
                                {"media_type": "movie", "id": 10}],
            "favorite_people": [4, 4],
        }
        with (patch("app.accounts.user_connection", return_value=conn) as connection,
              patch("app.favorite_titles.tmdb_get", return_value={"id": 10, "title": "Film", "name": "Show",
                                                                    "genres": [{"id": 18}]}) as titles,
              patch("app.catalog.tmdb_get", return_value={"id": 4, "name": "Person"}) as people):
            response = self.client.put("/api/me/setup", headers=self.headers, json=body)
        self.assertEqual(response.status_code, 200)
        connection.assert_called_once()
        people.assert_called_once_with("/person/4")
        self.assertEqual({call.args[0] for call in titles.call_args_list}, {"/movie/10", "/tv/10"})
        writes = [call.args for call in conn.execute.call_args_list]
        self.assertEqual([params[1:4] for sql, params in writes if "insert into public.favorite_titles" in sql],
                         [("movie", 10, "Film"), ("tv", 10, "Show")])
        self.assertEqual([params[1:3] for sql, params in writes if "insert into public.favorite_people" in sql],
                         [(4, "Person")])

    def test_setup_leaves_account_incomplete_if_a_favorite_cannot_be_verified(self) -> None:
        with (patch("app.accounts.user_connection") as connection,
              patch("app.favorite_titles.tmdb_get", return_value={"id": 99, "title": "Wrong title"})):
            response = self.client.put("/api/me/setup", headers=self.headers, json={
                "username": "New_user", "visibility": "private",
                "favorite_titles": [{"media_type": "movie", "id": 10}],
            })
        self.assertEqual(response.status_code, 404)
        connection.assert_not_called()


if __name__ == "__main__":
    unittest.main()
