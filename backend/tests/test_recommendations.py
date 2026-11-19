import time
import unittest
from unittest.mock import patch
from uuid import uuid4

import jwt
from fastapi.testclient import TestClient

from app.accounts import preference_store
from app.errors import APIError
from app.library import library_store
from app.main import app
from app.recommendations import MAX_TMDB_CALLS
from app.settings import Settings, get_settings


class FakePreferences:
    def __init__(self, genres, services=()):
        self.genres = genres
        self.services = services

    def get(self, user_id):
        return {"favorite_genres": list(self.genres), "streaming_services": list(self.services)}


class FakeLibrary:
    def __init__(self, rows):
        self.rows = rows

    def list(self, user_id, media_type, status):
        return list(self.rows)


def discover_result(ids, media_type):
    return {"results": [{"id": tmdb_id, "media_type": media_type, "popularity": 100 - index,
                         "title" if media_type == "movie" else "name": f"Title {tmdb_id}",
                         "poster_path": None, "overview": "", "release_date": "2024-01-01"}
                        for index, tmdb_id in enumerate(ids)]}


class RecommendationTest(unittest.TestCase):
    def setUp(self):
        self.secret = "a-test-secret-that-is-longer-than-32-bytes"
        self.settings = Settings("https://example.supabase.co", self.secret, "", ())
        app.dependency_overrides[get_settings] = lambda: self.settings
        self.client = TestClient(app)
        self.user = str(uuid4())

    def tearDown(self):
        app.dependency_overrides.clear()

    def headers(self):
        token = jwt.encode({"sub": self.user, "aud": "authenticated", "iss": self.settings.issuer,
                            "exp": int(time.time()) + 600, "role": "authenticated"}, self.secret,
                           algorithm="HS256")
        return {"Authorization": "Bearer " + token}

    def run_with(self, genres, library_rows, results):
        app.dependency_overrides[preference_store] = lambda: FakePreferences(genres)
        app.dependency_overrides[library_store] = lambda: FakeLibrary(library_rows)
        with patch("app.recommendations.tmdb_get", side_effect=lambda path, params=None: results(path)):
            return self.client.get("/api/me/recommendations", headers=self.headers())

    def test_genre_matches_are_ranked_and_labelled(self):
        results = lambda path: discover_result([1, 2] if path.endswith("movie") else [3], path.split("/")[-1])
        response = self.run_with(["Drama"], [], results)
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["basis"], "genres")
        self.assertEqual(len(body["items"]), 3)
        self.assertTrue(all(item["reason"] == "Drama" for item in body["items"]))

    def test_streaming_filter_uses_saved_providers_with_and_without_genres(self):
        for genres in ([], ["Drama"]):
            with self.subTest(genres=genres):
                app.dependency_overrides[preference_store] = lambda: FakePreferences(genres, ["Netflix", "Max"])
                app.dependency_overrides[library_store] = lambda: FakeLibrary([])
                with patch("app.recommendations.tmdb_get", return_value={"results": []}) as tmdb:
                    response = self.client.get("/api/me/recommendations?streaming_only=true", headers=self.headers())
                self.assertEqual(response.status_code, 200)
                self.assertEqual({call.args[0] for call in tmdb.call_args_list}, {"/discover/movie", "/discover/tv"})
                for _, params in (call.args for call in tmdb.call_args_list):
                    self.assertEqual(params["with_watch_providers"], "8|384|1899")
                    self.assertEqual(params["watch_region"], "US")
                    self.assertEqual(params["with_watch_monetization_types"], "flatrate")
                    self.assertEqual("with_genres" in params, bool(genres))

    def test_watched_and_completed_titles_are_excluded(self):
        results = lambda path: discover_result([1, 2] if path.endswith("movie") else [3], path.split("/")[-1])
        library = [
            {"media_type": "movie", "tmdb_id": 1, "status": "watched"},
            {"media_type": "tv", "tmdb_id": 3, "status": "completed"},
        ]
        body = self.run_with(["Drama"], library, results).json()
        self.assertEqual([(item["media_type"], item["id"]) for item in body["items"]], [("movie", 2)])

    def test_watchlist_titles_stay_eligible(self):
        results = lambda path: discover_result([1], "movie") if path.endswith("movie") else {"results": []}
        body = self.run_with(["Drama"], [{"media_type": "movie", "tmdb_id": 1, "status": "watchlist"}], results).json()
        self.assertEqual(len(body["items"]), 1)

    def test_new_user_gets_popular_titles(self):
        trending = {"results": [
            {"id": 10, "media_type": "movie", "popularity": 9, "title": "Popular", "poster_path": None},
            {"id": 11, "media_type": "person", "popularity": 9, "name": "Someone"},
        ]}
        body = self.run_with([], [], lambda path: trending).json()
        self.assertEqual(body["basis"], "popular")
        self.assertEqual([(item["media_type"], item["id"]) for item in body["items"]], [("movie", 10)])
        self.assertIsNone(body["items"][0]["reason"])

    def test_limit_and_auth(self):
        results = lambda path: discover_result(list(range(1, 21)), "movie")
        body = self.run_with(["Comedy"], [], results).json()
        self.assertEqual(len(body["items"]), 12)
        self.assertEqual(self.client.get("/api/me/recommendations").status_code, 401)


    def test_genre_requests_are_capped(self):
        import threading
        calls = []
        lock = threading.Lock()

        def results(path):
            with lock:
                calls.append(path)
            return discover_result([1, 2], "movie")

        genres = ["Action", "Animation", "Comedy", "Documentary", "Drama", "Fantasy",
                  "Horror", "Romance", "Science Fiction", "Thriller"]
        response = self.run_with(genres, [], results)
        self.assertEqual(response.status_code, 200)
        self.assertLessEqual(len(calls), MAX_TMDB_CALLS)
        self.assertGreater(len(calls), 1)

    def test_genre_requests_run_concurrently(self):
        import threading
        state = {"active": 0, "peak": 0}
        lock = threading.Lock()

        def results(path):
            with lock:
                state["active"] += 1
                state["peak"] = max(state["peak"], state["active"])
            time.sleep(0.05)
            with lock:
                state["active"] -= 1
            return discover_result([1, 2], "movie")

        response = self.run_with(["Drama", "Comedy"], [], results)
        self.assertEqual(response.status_code, 200)
        self.assertGreater(state["peak"], 1)

    def test_duplicate_genre_pages_are_fetched_once(self):
        import threading
        calls = []
        lock = threading.Lock()

        def results(path):
            with lock:
                calls.append(path)
            return discover_result([1], "tv")

        # Fantasy and Science Fiction share one TV genre id (10765).
        self.run_with(["Fantasy", "Science Fiction"], [], results)
        self.assertEqual(sorted(calls), ["/discover/movie", "/discover/movie", "/discover/tv"])

    def test_a_failed_genre_page_does_not_fail_the_request(self):
        def results(path, params=None):
            raise APIError(503, "catalog_rate_limited", "busy")

        app.dependency_overrides[preference_store] = lambda: FakePreferences(["Drama"])
        app.dependency_overrides[library_store] = lambda: FakeLibrary([])
        with patch("app.recommendations.tmdb_get", side_effect=results):
            response = self.client.get("/api/me/recommendations", headers=self.headers())
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["error"], "recommendations_unavailable")



if __name__ == "__main__":
    unittest.main()
