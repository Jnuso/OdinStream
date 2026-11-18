import io
import json
import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError

from fastapi.testclient import TestClient

from app.catalog import tmdb_get
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
