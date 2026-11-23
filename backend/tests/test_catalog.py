import time
import unittest
from unittest.mock import MagicMock, patch
from uuid import uuid4

import httpx
import jwt
from fastapi.testclient import TestClient

from app.accounts import preference_store
from app.catalog import clear_tmdb_cache, tmdb_get
from app.errors import APIError
from app.main import app
from app.settings import Settings, get_settings


class CatalogTest(unittest.TestCase):
    def setUp(self):
        clear_tmdb_cache()
        self.client = TestClient(app)

    def tearDown(self):
        clear_tmdb_cache()

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

    def test_streaming_services_merge_movie_and_tv_using_us_priority(self):
        movie = {"results": [
            {"provider_id": 8, "provider_name": "Netflix", "display_priority": 20,
             "display_priorities": {"US": 1}},
            {"provider_id": 1899, "provider_name": "HBO Max", "display_priority": 8},
        ]}
        tv = {"results": [
            {"provider_id": 384, "provider_name": "HBO Max", "display_priority": 3},
            {"provider_id": 386, "provider_name": "Peacock Premium", "display_priority": 2},
        ]}
        with patch("app.catalog.tmdb_get", side_effect=[movie, tv]) as fetch:
            response = self.client.get("/api/catalog/streaming-services")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"items": ["Netflix", "Peacock Premium", "Max"]})
        self.assertEqual([call.args for call in fetch.call_args_list], [
            ("/watch/providers/movie", {"watch_region": "US"}),
            ("/watch/providers/tv", {"watch_region": "US"}),
        ])

    def test_trending_excludes_people_and_adult_titles(self):
        movies = [
            {"id": index, "media_type": "movie", "title": f"Movie {index}", "backdrop_path": "/wide.jpg"}
            for index in range(10, 17)
        ]
        results = {"results": [
            {"id": 1, "media_type": "person", "name": "Actor"},
            {"id": 2, "media_type": "movie", "title": "Adult", "adult": True},
            *movies,
        ]}
        with patch("app.catalog.tmdb_get", return_value=results) as fetch:
            response = self.client.get("/api/catalog/trending")
        fetch.assert_called_once_with("/trending/all/week")
        self.assertEqual(response.status_code, 200)
        self.assertEqual([item["id"] for item in response.json()["items"]], list(range(10, 16)))
        self.assertEqual(response.json()["items"][0]["backdrop_path"], "/wide.jpg")

    def test_people_search_includes_credits_to_distinguish_names(self):
        results = {"page": 2, "total_pages": 3, "results": [
            {"id": 11, "name": "Alex", "known_for_department": "Directing",
             "known_for": [{"title": "Film"}, {"name": "Series"}, {"title": "Adult", "adult": True}]},
            {"id": 12, "name": "Adult person", "adult": True},
        ]}
        with patch("app.catalog.tmdb_get", return_value=results) as fetch:
            response = self.client.get("/api/catalog/people/search", params={"query": " Alex ", "page": 2})
        fetch.assert_called_once_with("/search/person", {"query": "Alex", "page": 2, "include_adult": "false"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"page": 2, "total_pages": 3, "items": [
            {"id": 11, "name": "Alex", "profile_path": None, "known_for_department": "Directing",
             "known_for": ["Film", "Series"]},
        ]})

    def test_search_type_uses_the_matching_tmdb_endpoint(self):
        results = {"results": [{"id": 1, "name": "A show"}], "page": 2, "total_pages": 3}
        with patch("app.catalog.tmdb_get", return_value=results) as fetch:
            response = self.client.get("/api/catalog/search?query=show&media_type=tv&page=2")
        fetch.assert_called_once_with("/search/tv", {"query": "show", "page": 2, "include_adult": "false"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["items"][0]["media_type"], "tv")
        self.assertEqual(response.json()["total_pages"], 3)

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
            if path == "/search/multi":
                return results
            if path == "/movie/1/watch/providers":
                return {"results": {"US": {"flatrate": [{"provider_id": 8, "provider_name": "Netflix"}]}}}
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
        with patch("app.catalog.tmdb_get", return_value={"id": 1, "title": "A", "watch/providers": {"results": {}}}):
            response = self.client.get("/api/catalog/movie/1")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["availability"], {"link": None, "flatrate": [], "rent": [], "buy": []})

    def test_movie_details_include_directors_and_cast(self):
        director = {"id": 2, "name": "Director One", "profile_path": "/director.jpg"}
        data = {"id": 1, "title": "A", "watch/providers": {}, "credits": {
            "crew": [{**director, "job": "Director"}, {**director, "job": "Director"},
                     {"id": 3, "name": "Producer", "job": "Producer"}],
            "cast": [{"id": 4, "name": "Actor", "character": "Lead"}],
        }}
        with patch("app.catalog.tmdb_get", return_value=data) as fetch:
            response = self.client.get("/api/catalog/movie/1")
        fetch.assert_called_once_with("/movie/1", {"append_to_response": "watch/providers,credits"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["directors"], [director])
        self.assertEqual(response.json()["cast"][0]["characters"], ["Lead"])

    def test_invalid_inputs(self):
        self.assertEqual(self.client.get("/api/catalog/search", params={"query": "  "}).status_code, 422)
        self.assertEqual(self.client.get("/api/catalog/movie/0").status_code, 422)
        self.assertEqual(self.client.get("/api/catalog/person/1").status_code, 422)

    def test_tv_details_include_cast_from_across_the_series(self):
        data = {
            "id": 1,
            "name": "A show",
            "created_by": [{"id": 5, "name": "Creator", "profile_path": "/creator.jpg"}],
            "watch/providers": {"results": {}},
            "aggregate_credits": {
                "cast": [
                    {"id": 2, "name": "Actor One", "profile_path": "/portrait.jpg",
                     "roles": [{"character": "Lead"}, {"character": "Double"}, {"character": "Lead"}]},
                    {"id": 3, "name": "Actor Two", "roles": []},
                ],
                "crew": [{"id": 4, "name": "Director"}],
            },
        }
        with patch("app.catalog.tmdb_get", return_value=data) as fetch:
            response = self.client.get("/api/catalog/tv/1")
        fetch.assert_called_once_with("/tv/1", {"append_to_response": "watch/providers,aggregate_credits"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["creators"], data["created_by"])
        self.assertEqual(response.json()["directors"], [])
        self.assertEqual(response.json()["cast"], [
            {"id": 2, "name": "Actor One", "profile_path": "/portrait.jpg", "characters": ["Lead", "Double"]},
            {"id": 3, "name": "Actor Two", "profile_path": None, "characters": []},
        ])

    def test_upstream_errors(self):
        request = httpx.Request("GET", "https://api.themoviedb.org/3/movie/1")
        errors = [
            (httpx.HTTPStatusError("404", request=request, response=httpx.Response(404, request=request)), 404),
            (httpx.HTTPStatusError("429", request=request, response=httpx.Response(429, request=request)), 503),
            (httpx.ConnectError("offline", request=request), 503),
        ]
        with patch.dict("os.environ", {"TMDB_READ_ACCESS_TOKEN": "test"}):
            for error, status in errors:
                mock_client = MagicMock()
                mock_client.get.side_effect = error
                with self.subTest(status=status), patch("app.catalog._get_client", return_value=mock_client):
                    with self.assertRaises(APIError) as raised:
                        tmdb_get("/movie/1")
                    self.assertEqual(raised.exception.status_code, status)

    def test_season_route(self):
        data = {"name": "Season 1", "episodes": [
            {"episode_number": 1, "name": "Pilot",
             "crew": [{"id": 7, "name": "Director", "job": "Director"}]},
            {"episode_number": 2, "name": "Second"},
        ]}
        with patch("app.catalog.tmdb_get", return_value=data):
            response = self.client.get("/api/catalog/tv/1/seasons/1")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["episodes"][0]["name"], "Pilot")
        self.assertEqual(response.json()["episodes"][0]["directors"], [
            {"id": 7, "name": "Director", "profile_path": None},
        ])
        self.assertEqual(response.json()["episodes"][1]["directors"], [])

    def test_person_credits_include_only_distinct_cast_titles(self):
        movie = {"id": 1, "media_type": "movie", "title": "Movie", "release_date": "2022-01-01"}
        show = {"id": 1, "media_type": "tv", "name": "Show", "first_air_date": "2024-01-01"}
        data = {"cast": [{**movie, "character": "Lead"}, show, {**movie, "character": "Double"},
                         {**movie, "id": 2, "adult": True}], "crew": [{**movie, "id": 3}]}
        with patch("app.catalog.tmdb_get", return_value=data) as fetch:
            response = self.client.get("/api/catalog/people/7/credits")
        fetch.assert_called_once_with("/person/7/combined_credits")
        self.assertEqual(response.status_code, 200)
        self.assertEqual([(item["name"], item["characters"]) for item in response.json()["items"]],
                         [("Show", []), ("Movie", ["Lead", "Double"])])

    def test_person_crew_credits_filter_by_role(self):
        show = {"id": 1, "media_type": "tv", "name": "Created show", "job": "Creator"}
        movie = {"id": 1, "media_type": "movie", "title": "Directed movie", "job": "Director"}
        data = {"cast": [{"id": 2, "media_type": "tv", "name": "Acted in"}],
                "crew": [show, movie, movie, {**show, "id": 3, "job": "Executive Producer"}]}
        with patch("app.catalog.tmdb_get", return_value=data):
            for role, name in (("creator", "Created show"), ("director", "Directed movie")):
                with self.subTest(role=role):
                    response = self.client.get("/api/catalog/people/7/credits", params={"role": role})
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual([item["name"] for item in response.json()["items"]], [name])

    def test_actor_profile_returns_biography_and_optional_facts(self):
        with patch("app.catalog.tmdb_get", return_value={
            "id": 7, "name": "Actor", "biography": "A biography.", "birthday": "1973-04-03",
            "place_of_birth": "Santa Cruz", "profile_path": "/portrait.jpg",
        }) as fetch:
            response = self.client.get("/api/catalog/people/7")
        fetch.assert_called_once_with("/person/7")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {
            "id": 7, "name": "Actor", "biography": "A biography.", "birthday": "1973-04-03",
            "deathday": None, "place_of_birth": "Santa Cruz", "profile_path": "/portrait.jpg",
        })


if __name__ == "__main__":
    unittest.main()
