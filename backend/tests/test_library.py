import time
import unittest
from unittest.mock import patch
from uuid import uuid4

import jwt
from fastapi.testclient import TestClient

from app.errors import APIError
from app.library import library_store
from app.main import app
from app.settings import Settings, get_settings


class FakeStore:
    def __init__(self):
        self.rows = {}
        self.progress = {}
        self.counter = 0

    def list(self, user_id, media_type, status, limit=None, offset=0):
        rows = [row for owner, row in self.rows.values() if owner == user_id
                and (media_type is None or row["media_type"] == media_type)
                and (status is None or row["status"] == status)]
        return rows[offset:offset + limit] if limit is not None else rows[offset:]

    def create(self, user_id, media_type, tmdb_id, status):
        if any(owner == user_id and row["media_type"] == media_type and row["tmdb_id"] == tmdb_id
               for owner, row in self.rows.values()):
            raise APIError(409, "duplicate_title", "This title is already in your library.")
        entry_id = uuid4()
        row = {"id": str(entry_id), "media_type": media_type, "tmdb_id": tmdb_id, "status": status}
        self.rows[entry_id] = (user_id, row)
        return row

    def get(self, user_id, entry_id):
        item = self.rows.get(entry_id)
        return item[1] if item and item[0] == user_id else None

    def update(self, user_id, entry_id, status):
        row = self.get(user_id, entry_id)
        if row is not None:
            row["status"] = status
        return row

    def delete(self, user_id, entry_id):
        if self.get(user_id, entry_id) is None:
            return None
        return self.rows.pop(entry_id)[1]

    def episodes(self, user_id, entry_id):
        entry = self.get(user_id, entry_id)
        rows = [(key, order) for key, order in self.progress.items() if key[0] == user_id and key[1] == entry["tmdb_id"]]
        return [{"season_number": key[2], "episode_number": key[3]} for key, _ in sorted(rows, key=lambda x: x[1], reverse=True)]

    def mark_episodes(self, user_id, entry_id, season, numbers, *, bulk=False):
        tmdb_id = self.get(user_id, entry_id)["tmdb_id"]
        for number in sorted(numbers):
            key = (user_id, tmdb_id, season, number)
            if bulk or key not in self.progress:
                self.counter += 1
                self.progress[key] = self.counter

    def unmark_episodes(self, user_id, entry_id, season, numbers=None):
        tmdb_id = self.get(user_id, entry_id)["tmdb_id"]
        self.progress = {key: order for key, order in self.progress.items() if not (key[0] == user_id and key[1] == tmdb_id
                         and key[2] == season and (numbers is None or key[3] in numbers))}



class LibraryTest(unittest.TestCase):
    def setUp(self):
        self.secret = "a-test-secret-that-is-longer-than-32-bytes"
        self.settings = Settings("https://example.supabase.co", self.secret, "", ())
        self.store = FakeStore()
        app.dependency_overrides[get_settings] = lambda: self.settings
        app.dependency_overrides[library_store] = lambda: self.store
        self.client = TestClient(app, client=(self.id(), 50000))
        self.user_a, self.user_b = str(uuid4()), str(uuid4())

    def tearDown(self):
        app.dependency_overrides.clear()

    def headers(self, user):
        token = jwt.encode({"sub": user, "aud": "authenticated", "iss": self.settings.issuer,
                            "exp": int(time.time()) + 600, "role": "authenticated"}, self.secret, algorithm="HS256")
        return {"Authorization": "Bearer " + token}

    def test_owner_isolation_duplicate_and_statuses(self):
        a, b = self.headers(self.user_a), self.headers(self.user_b)
        body = {"media_type": "movie", "tmdb_id": 42, "status": "watchlist"}
        self.assertEqual(self.client.get("/api/me/saved-titles").status_code, 401)
        with patch("app.library.tmdb_get", return_value={"id": 42}):
            result = self.client.post("/api/me/saved-titles", headers=a, json=body)
            self.assertEqual(result.status_code, 201)
            entry_id = result.json()["id"]
            self.assertEqual(self.client.post("/api/me/saved-titles", headers=a, json=body).status_code, 409)
            self.assertEqual(self.client.post("/api/me/saved-titles", headers=b, json=body).status_code, 201)
        self.assertEqual(len(self.client.get("/api/me/saved-titles", headers=b).json()["items"]), 1)
        self.assertEqual(self.client.patch(f"/api/me/saved-titles/{entry_id}", headers=b, json={"status": "watched"}).status_code, 404)
        self.assertEqual(self.client.delete(f"/api/me/saved-titles/{entry_id}", headers=b).status_code, 404)
        self.assertEqual(self.client.patch(f"/api/me/saved-titles/{entry_id}", headers=a, json={"status": "watching"}).status_code, 422)
        self.assertEqual(self.client.patch(f"/api/me/saved-titles/{entry_id}", headers=a, json={"status": "watched"}).json()["status"], "watched")
        self.assertEqual(self.client.delete(f"/api/me/saved-titles/{entry_id}", headers=a).status_code, 204)
        self.assertEqual(self.client.get("/api/me/saved-titles", headers=a).json()["items"], [])
        self.assertEqual(result.headers["cache-control"], "private, no-store")

    def test_unverified_or_invalid_titles_are_not_saved(self):
        headers = self.headers(self.user_a)
        body = {"media_type": "tv", "tmdb_id": 42, "status": "watchlist"}
        for error, status in [(APIError(404, "title_not_found", "not found"), 404),
                              (APIError(503, "catalog_unavailable", "offline"), 503)]:
            with patch("app.library.tmdb_get", side_effect=error):
                self.assertEqual(self.client.post("/api/me/saved-titles", headers=headers, json=body).status_code, status)
        with patch("app.library.tmdb_get", return_value={"id": 43}):
            self.assertEqual(self.client.post("/api/me/saved-titles", headers=headers, json=body).status_code, 502)
        for invalid in [{**body, "tmdb_id": 0}, {**body, "tmdb_id": 9223372036854775808}, {**body, "tmdb_id": True},
                        {**body, "status": "watched"}, {**body, "user_id": self.user_b}]:
            self.assertEqual(self.client.post("/api/me/saved-titles", headers=headers, json=invalid).status_code, 422)
        self.assertEqual(self.store.rows, {})

    def test_episode_progress_ownership_validation_and_undo(self):
        a, b = self.headers(self.user_a), self.headers(self.user_b)
        with patch("app.library.tmdb_get", return_value={"id": 42}):
            entry_id = self.client.post("/api/me/saved-titles", headers=a,
                json={"media_type": "tv", "tmdb_id": 42, "status": "watchlist"}).json()["id"]
            movie_id = self.client.post("/api/me/saved-titles", headers=a,
                json={"media_type": "movie", "tmdb_id": 42, "status": "watchlist"}).json()["id"]
        base = f"/api/me/saved-titles/{entry_id}"
        self.assertEqual(self.client.get(base + "/episodes").status_code, 401)
        self.assertEqual(self.client.get(base + "/episodes", headers=b).status_code, 404)
        self.assertEqual(self.client.put(base + "/seasons/1/episodes/1", headers=b).status_code, 404)
        self.assertEqual(self.client.get(f"/api/me/saved-titles/{movie_id}/episodes", headers=a).status_code, 422)
        data = {"season_number": 1, "episodes": [{"episode_number": 1}, {"episode_number": 2}]}
        with patch("app.library.tmdb_get", return_value=data):
            self.assertEqual(self.client.put(base + "/seasons/1/episodes/3", headers=a).status_code, 422)
            self.assertEqual(self.client.put(base + "/seasons/1/episodes/1", headers=a).status_code, 204)
            self.assertEqual(self.client.put(base + "/seasons/1/episodes/1", headers=a).status_code, 204)
            self.assertEqual(self.client.put(base + "/seasons/1/episodes", headers=a).status_code, 204)
        self.assertEqual(self.client.get(base + "/episodes", headers=a).json()["items"],
                         [{"season_number": 1, "episode_number": 1}, {"season_number": 1, "episode_number": 2}])
        self.assertEqual(self.client.delete(base + "/seasons/1/episodes/1", headers=a).status_code, 204)
        self.assertEqual(self.client.get(base + "/episodes", headers=a).json()["items"], [{"season_number": 1, "episode_number": 2}])
        self.assertEqual(self.client.delete(base + "/seasons/1/episodes", headers=a).status_code, 204)
        self.assertEqual(self.client.get(base + "/episodes", headers=a).json()["items"], [])
        self.assertEqual(self.client.put(base + "/seasons/-1/episodes/1", headers=a).status_code, 422)
        with patch("app.library.tmdb_get", side_effect=APIError(503, "catalog_unavailable", "offline")):
            self.assertEqual(self.client.put(base + "/seasons/1/episodes", headers=a).status_code, 503)
        with patch("app.library.tmdb_get", return_value={"episodes": [None]}):
            self.assertEqual(self.client.put(base + "/seasons/1/episodes", headers=a).status_code, 502)
        self.assertEqual(self.client.get(base + "/episodes", headers=a).json()["items"], [])

    def test_unmark_episode_does_not_require_tmdb_or_remove_other_progress(self):
        a, b = self.headers(self.user_a), self.headers(self.user_b)
        with patch("app.library.tmdb_get", return_value={"id": 42}):
            body = {"media_type": "tv", "tmdb_id": 42, "status": "watching"}
            entry_a = self.client.post("/api/me/saved-titles", headers=a, json=body).json()["id"]
            entry_b = self.client.post("/api/me/saved-titles", headers=b, json=body).json()["id"]
        base_a, base_b = f"/api/me/saved-titles/{entry_a}", f"/api/me/saved-titles/{entry_b}"
        with patch("app.library.tmdb_get", return_value={"season_number": 1, "episodes": [
            {"episode_number": 1}, {"episode_number": 2}]}):
            self.assertEqual(self.client.put(base_a + "/seasons/1/episodes", headers=a).status_code, 204)
            self.assertEqual(self.client.put(base_b + "/seasons/1/episodes", headers=b).status_code, 204)
        with patch("app.library.tmdb_get", side_effect=APIError(503, "catalog_unavailable", "offline")) as tmdb:
            self.assertEqual(self.client.delete(base_a + "/seasons/1/episodes/1", headers=b).status_code, 404)
            self.assertEqual(self.client.delete(base_a + "/seasons/1/episodes/1", headers=a).status_code, 204)
            tmdb.assert_not_called()
            self.assertEqual(self.client.get(base_a + "/episodes", headers=a).json()["items"],
                [{"season_number": 1, "episode_number": 2}])
            self.assertEqual(self.client.get(base_b + "/episodes", headers=b).json()["items"],
                [{"season_number": 1, "episode_number": 1}, {"season_number": 1, "episode_number": 2}])

    def test_history_restored_and_last_watched_follows_mark_order(self):
        headers = self.headers(self.user_a)
        body = {"media_type": "tv", "tmdb_id": 99, "status": "watching"}
        with patch("app.library.tmdb_get", return_value={"id": 99}):
            first = self.client.post("/api/me/saved-titles", headers=headers, json=body).json()["id"]
        base = f"/api/me/saved-titles/{first}"
        season = {"season_number": 1, "episodes": [{"episode_number": n} for n in (1, 2, 3)]}
        with patch("app.library.tmdb_get", return_value=season):
            self.client.put(base + "/seasons/1/episodes/3", headers=headers)
            self.client.put(base + "/seasons/1/episodes/1", headers=headers)
        self.assertEqual(self.client.get(base + "/episodes", headers=headers).json()["last_watched"]["episode_number"], 1)
        self.client.delete(base + "/seasons/1/episodes/1", headers=headers)
        self.assertEqual(self.client.get(base + "/episodes", headers=headers).json()["last_watched"]["episode_number"], 3)
        self.client.delete(base, headers=headers)
        with patch("app.library.tmdb_get", return_value={"id": 99}):
            second = self.client.post("/api/me/saved-titles", headers=headers, json=body).json()["id"]
        self.assertEqual(self.client.get(f"/api/me/saved-titles/{second}/episodes", headers=headers).json()["items"],
                         [{"season_number": 1, "episode_number": 3}])
        with patch("app.library.tmdb_get", return_value=season):
            self.client.put(f"/api/me/saved-titles/{second}/seasons/1/episodes", headers=headers)
        self.assertEqual(self.client.get(f"/api/me/saved-titles/{second}/episodes", headers=headers).json()["last_watched"]["episode_number"], 3)

    def test_library_pagination(self):
        headers = self.headers(self.user_a)
        for number in (1, 2, 3):
            with patch("app.library.tmdb_get", return_value={"id": number}):
                self.assertEqual(self.client.post("/api/me/saved-titles", headers=headers,
                    json={"media_type": "movie", "tmdb_id": number, "status": "watchlist"}).status_code, 201)
        first = self.client.get("/api/me/saved-titles?limit=2", headers=headers).json()
        self.assertEqual(len(first["items"]), 2)
        self.assertEqual(first["next_offset"], 2)
        second = self.client.get("/api/me/saved-titles?limit=2&offset=2", headers=headers).json()
        self.assertEqual(len(second["items"]), 1)
        self.assertIsNone(second["next_offset"])

    def test_browser_cors_preflight(self):
        response = self.client.options("/api/me/saved-titles", headers={"Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type"})
        self.assertEqual(response.status_code, 200)


if __name__ == "__main__":
    unittest.main()
