import io
import json
import unittest
import time
from uuid import uuid4

import jwt
from unittest.mock import patch
from urllib.error import HTTPError, URLError

from fastapi.testclient import TestClient

from app.catalog import tmdb_get
from app.accounts import preference_store
from app.settings import Settings, get_settings
from app.errors import APIError
from app.main import app


class CatalogTest(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_search_filters_people_and_maps_titles(self):
        results = {"results": [
            {"id": 1, "media_type": "movie", "title": "A", "release_date": "2024-01-01"},
            {"id": 2, "media_type": "tv", "name": "B"},
            {"id": 3, "media_type": "person", "name": "C"},
        ], "page": 1, "total_pages": 1}
        with patch("app.catalog.tmdb_get", return_value=results):
            response = self.client.get("/api/catalog/search", params={"query": "A"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual([(x["media_type"], x["name"]) for x in response.json()["items"]], [("movie", "A"), ("tv", "B")])

    def test_service_filter_uses_saved_subscriptions_and_pagination(self):
        secret = "test-secret-that-is-longer-than-32-characters"
        settings = Settings("https://example.supabase.co", secret, "", ())
        user = str(uuid4())
        token = jwt.encode({"sub": user, "aud": "authenticated", "iss": settings.issuer,
                            "exp": int(time.time()) + 600, "role": "authenticated"}, secret, algorithm="HS256")
        app.dependency_overrides[get_settings] = lambda: settings
        app.dependency_overrides[preference_store] = lambda: type("Store", (), {"get": lambda _, uid: {"streaming_services": ["Netflix"]}})()
        results = {"results": [{"id": 1, "media_type": "movie", "title": "A"},
                               {"id": 2, "media_type": "tv", "name": "B"}], "page": 2, "total_pages": 3}
        def upstream(path, params=None):
            if path == "/search/multi": return results
            if path == "/movie/1/watch/providers": return {"results": {"US": {"flatrate": [{"provider_id": 8, "provider_name": "Netflix"}]}}}
            return {"results": {"US": {"rent": [{"provider_id": 8}]}}}
        try:
            with patch("app.catalog.tmdb_get", side_effect=upstream):
                response = self.client.get("/api/me/catalog/search?query=A&page=2", headers={"Authorization": "Bearer " + token})
            self.assertEqual(response.status_code, 200)
            self.assertEqual([item["id"] for item in response.json()["items"]], [1])
            self.assertEqual((response.json()["page"], response.json()["total_pages"]), (2, 3))
            self.assertEqual(self.client.get("/api/me/catalog/search?query=A").status_code, 401)
            app.dependency_overrides[preference_store] = lambda: type("Store", (), {"get": lambda _, uid: {"streaming_services": []}})()
            self.assertEqual(self.client.get("/api/me/catalog/search?query=A", headers={"Authorization": "Bearer " + token}).json()["error"], "no_streaming_services")
            app.dependency_overrides[preference_store] = lambda: type("Store", (), {"get": lambda _, uid: {"streaming_services": ["Netflix"]}})()
            with patch("app.catalog.tmdb_get", side_effect=APIError(503, "catalog_unavailable", "offline")):
                self.assertEqual(self.client.get("/api/me/catalog/search?query=A", headers={"Authorization": "Bearer " + token}).status_code, 503)
        finally:
            app.dependency_overrides.clear()

    def test_validation_errors_share_error_shape(self):
        response = self.client.get("/api/catalog/search", params={"query": "x", "page": 0})
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["error"], "validation_error")
        self.assertIn("message", response.json())
        self.assertEqual(response.json()["details"][0]["field"], "query.page")

    def test_details_and_missing_us_availability(self):
        with patch("app.catalog.tmdb_get", side_effect=[{"id": 1, "title": "A"}, {"results": {}}]):
            response = self.client.get("/api/catalog/movie/1")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["availability"], {"link": None, "flatrate": [], "rent": [], "buy": []})

    def test_invalid_inputs(self):
        self.assertEqual(self.client.get("/api/catalog/search", params={"query": "  "}).status_code, 422)
        self.assertEqual(self.client.get("/api/catalog/movie/0").status_code, 422)
        self.assertEqual(self.client.get("/api/catalog/person/1").status_code, 422)

    def test_upstream_errors(self):
        with patch.dict("os.environ", {"TMDB_READ_ACCESS_TOKEN": "test"}):
            for error, status in [(HTTPError("url", 404, "", {}, io.BytesIO()), 404),
                                  (HTTPError("url", 429, "", {}, io.BytesIO()), 503),
                                  (URLError("offline"), 503)]:
                with self.subTest(status=status), patch("app.catalog.urlopen", side_effect=error):
                    with self.assertRaises(APIError) as raised:
                        tmdb_get("/movie/1")
                    self.assertEqual(raised.exception.status_code, status)

    def test_season_route(self):
        data = {"name": "Season 1", "episodes": [{"episode_number": 1, "name": "Pilot"}]}
        with patch("app.catalog.tmdb_get", return_value=data):
            response = self.client.get("/api/catalog/tv/1/seasons/1")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["episodes"][0]["name"], "Pilot")


if __name__ == "__main__":
    unittest.main()
