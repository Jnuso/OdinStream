"""Edge-case, boundary, idempotency, and malformed-input tests for Odin Stream backend."""

from __future__ import annotations

import time
import unittest
from datetime import datetime, timezone
from unittest.mock import patch
from uuid import uuid4

import jwt
from fastapi.testclient import TestClient

from app.accounts import preference_store
from app.errors import APIError
from app.library import library_store
from app.main import app
from app.settings import Settings, get_settings
from app.social import shape_post, social_store

TEST_SECRET = "edge-case-test-secret-that-is-well-over-32-bytes"
SUPABASE_URL = "https://example.supabase.co"


def _headers(user_id: str) -> dict[str, str]:
    token = jwt.encode(
        {
            "sub": user_id,
            "email": "edge@example.test",
            "aud": "authenticated",
            "iss": f"{SUPABASE_URL}/auth/v1",
            "exp": int(time.time()) + 600,
            "role": "authenticated",
        },
        TEST_SECRET,
        algorithm="HS256",
    )
    return {"Authorization": f"Bearer {token}"}


class _EdgeLibraryStore:
    def __init__(self) -> None:
        self.rows: dict = {}
        self.progress: dict = {}
        self.counter = 0

    def list(self, user_id, media_type, status, limit=None, offset=0):
        rows = [
            row
            for owner, row in self.rows.values()
            if owner == user_id
            and (media_type is None or row["media_type"] == media_type)
            and (status is None or row["status"] == status)
        ]
        return rows[offset : offset + limit] if limit is not None else rows[offset:]

    def create(self, user_id, media_type, tmdb_id, status):
        if any(
            owner == user_id and row["media_type"] == media_type and row["tmdb_id"] == tmdb_id
            for owner, row in self.rows.values()
        ):
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
        return [{"season_number": k[2], "episode_number": k[3]} for k, _ in sorted(rows, key=lambda x: x[1], reverse=True)]

    def mark_episodes(self, user_id, entry_id, season, numbers, *, bulk=False):
        tmdb_id = self.get(user_id, entry_id)["tmdb_id"]
        for num in sorted(numbers):
            key = (user_id, tmdb_id, season, num)
            if bulk or key not in self.progress:
                self.counter += 1
                self.progress[key] = self.counter
        return numbers

    def unmark_episodes(self, user_id, entry_id, season, numbers=None):
        tmdb_id = self.get(user_id, entry_id)["tmdb_id"]
        self.progress = {
            k: v
            for k, v in self.progress.items()
            if not (k[0] == user_id and k[1] == tmdb_id and k[2] == season and (numbers is None or k[3] in numbers))
        }
        return []


class _EdgeSocialStore:
    def __init__(self, user_a: str, user_b: str) -> None:
        self.profiles_map = {
            user_a: {"id": user_a, "display_name": "Alpha", "handle": "alpha.1", "bio": "", "visibility": "public"},
            user_b: {"id": user_b, "display_name": "Beta", "handle": "beta.2", "bio": "", "visibility": "public"},
        }
        self.posts: dict = {}
        self.follows: set[tuple[str, str]] = set()

    def profile(self, viewer_id, target_id):
        row = self.profiles_map.get(target_id)
        if row is None:
            raise APIError(404, "profile_not_found", "Profile not found.")
        return {
            **row,
            "post_count": 0,
            "follower_count": 0,
            "following_count": 0,
            "can_view_posts": True,
            "viewer_follows": (viewer_id, target_id) in self.follows,
            "viewer_requested": False,
        }

    def feed(self, user_id, scope, limit, offset):
        items = [shape_post(p) for p in self.posts.values()]
        return items[offset : offset + limit]

    def posts_by_author(self, user_id, target_id, limit, offset):
        items = [shape_post(p) for p in self.posts.values() if p["author_id"] == target_id]
        return items[offset : offset + limit]

    def requests(self, user_id, limit, offset):
        return []

    def follow(self, user_id, target_id):
        self.profile(user_id, target_id)
        self.follows.add((user_id, target_id))

    def unfollow(self, user_id, target_id):
        self.follows.discard((user_id, target_id))

    def create(self, user_id, media_type, tmdb_id, title, rating, review):
        post_id = str(uuid4())
        row = {
            "id": post_id,
            "media_type": media_type,
            "tmdb_id": tmdb_id,
            "title_name": title["name"],
            "poster_path": title["poster_path"],
            "release_date": title["release_date"],
            "rating": rating,
            "review": review,
            "created_at": datetime.now(timezone.utc),
            "updated_at": datetime.now(timezone.utc),
            "author_id": user_id,
            "author_name": "Alpha",
            "author_handle": "alpha.1",
        }
        self.posts[post_id] = row
        return shape_post(row)


class _EdgePreferenceStore:
    def get(self, user_id):
        return {"favorite_genres": ["Drama", "Comedy"], "streaming_services": ["Netflix"]}


class EdgeCasesAndAbuseTest(unittest.TestCase):
    def setUp(self) -> None:
        self.user_a = str(uuid4())
        self.user_b = str(uuid4())
        self.settings = Settings(SUPABASE_URL, TEST_SECRET, "", ())
        self.library = _EdgeLibraryStore()
        self.social = _EdgeSocialStore(self.user_a, self.user_b)
        self.preferences = _EdgePreferenceStore()
        app.dependency_overrides[get_settings] = lambda: self.settings
        app.dependency_overrides[library_store] = lambda: self.library
        app.dependency_overrides[social_store] = lambda: self.social
        app.dependency_overrides[preference_store] = lambda: self.preferences
        self.client = TestClient(app)

    def tearDown(self) -> None:
        app.dependency_overrides.clear()

    def test_pagination_bounds_rejected_across_list_endpoints(self) -> None:
        headers = _headers(self.user_a)
        endpoints = (
            "/api/me/saved-titles",
            "/api/feed",
            f"/api/profiles/{self.user_a}/posts",
            "/api/me/follow-requests",
        )
        for path in endpoints:
            for query in ("?limit=0", "?limit=51", "?offset=-1", "?limit=abc"):
                with self.subTest(path=path, query=query):
                    res = self.client.get(path + query, headers=headers)
                    self.assertEqual(res.status_code, 422)
                    self.assertEqual(res.json()["error"], "validation_error")

    def test_malformed_json_and_wrong_content_type_return_422(self) -> None:
        headers = {**_headers(self.user_a), "Content-Type": "application/json"}
        res = self.client.post("/api/me/saved-titles", headers=headers, content=b"{invalid json")
        self.assertEqual(res.status_code, 422)
        self.assertEqual(res.json()["error"], "validation_error")

        text_headers = {**_headers(self.user_a), "Content-Type": "text/plain"}
        res2 = self.client.post("/api/me/saved-titles", headers=text_headers, content=b"media_type=movie")
        self.assertEqual(res2.status_code, 422)

    def test_season_zero_specials_and_episode_bounds(self) -> None:
        headers = _headers(self.user_a)
        with patch("app.library.tmdb_get", return_value={"id": 1396}):
            entry_id = self.client.post(
                "/api/me/saved-titles",
                headers=headers,
                json={"media_type": "tv", "tmdb_id": 1396, "status": "watching"},
            ).json()["id"]
        base = f"/api/me/saved-titles/{entry_id}"

        with patch("app.library.tmdb_get", return_value={"season_number": 0, "episodes": [{"episode_number": 1}]}):
            self.assertEqual(self.client.put(f"{base}/seasons/0/episodes/1", headers=headers).status_code, 204)
            self.assertEqual(self.client.put(f"{base}/seasons/0/episodes/1", headers=headers).status_code, 204)

        for bad_path in (
            f"{base}/seasons/-1/episodes/1",
            f"{base}/seasons/1/episodes/0",
            f"{base}/seasons/1/episodes/{2**31}",
            f"{base}/seasons/{2**31}/episodes/1",
        ):
            with self.subTest(bad_path=bad_path):
                self.assertEqual(self.client.put(bad_path, headers=headers).status_code, 422)

        for bad_tmdb in (
            {"season_number": 1, "episodes": "not-a-list"},
            {"season_number": 2, "episodes": [{"episode_number": 1}]},
            {"season_number": 1, "episodes": [{"episode_number": "1"}]},
            {"season_number": 1, "episodes": [{"episode_number": 0}]},
        ):
            with self.subTest(bad_tmdb=bad_tmdb), patch("app.library.tmdb_get", return_value=bad_tmdb):
                self.assertEqual(self.client.put(f"{base}/seasons/1/episodes/1", headers=headers).status_code, 502)

        with patch("app.library.tmdb_get", return_value={"season_number": 1, "episodes": []}):
            res = self.client.put(f"{base}/seasons/1/episodes", headers=headers)
            self.assertEqual(res.status_code, 422)
            self.assertEqual(res.json()["error"], "empty_season")

    def test_whitespace_only_review_normalizes_to_null(self) -> None:
        headers = _headers(self.user_a)
        with patch(
            "app.social.tmdb_get",
            return_value={"id": 603, "title": "The Matrix", "poster_path": None, "release_date": "1999-03-31"},
        ):
            res = self.client.post(
                "/api/titles/movie/603/posts",
                headers=headers,
                json={"rating": 3.5, "review": "   \n\t  "},
            )
        self.assertEqual(res.status_code, 201)
        self.assertIsNone(res.json()["review"])

    def test_idempotent_follow_and_unfollow(self) -> None:
        headers = _headers(self.user_a)
        self.assertEqual(self.client.put(f"/api/profiles/{self.user_b}/follow", headers=headers).status_code, 204)
        self.assertEqual(self.client.put(f"/api/profiles/{self.user_b}/follow", headers=headers).status_code, 204)
        self.assertEqual(self.client.delete(f"/api/profiles/{self.user_b}/follow", headers=headers).status_code, 204)
        self.assertEqual(self.client.delete(f"/api/profiles/{self.user_b}/follow", headers=headers).status_code, 204)

    def test_partial_tmdb_failure_still_returns_recommendations(self) -> None:
        headers = _headers(self.user_a)

        def flaky_tmdb(path, params=None):
            if path == "/discover/movie":
                raise APIError(503, "catalog_rate_limited", "busy")
            return {
                "results": [
                    {
                        "id": 42,
                        "name": "Surviving Show",
                        "popularity": 80,
                        "poster_path": None,
                        "overview": "",
                        "first_air_date": "2025-01-01",
                    }
                ]
            }

        with patch("app.recommendations.tmdb_get", side_effect=flaky_tmdb):
            res = self.client.get("/api/me/recommendations", headers=headers)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["items"][0]["id"], 42)


if __name__ == "__main__":
    unittest.main()
