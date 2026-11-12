"""Live TMDB checks using the project .env file or an environment variable."""
import json
import os
import unittest
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from pathlib import Path

BASE_URL = "https://api.themoviedb.org/3"
def read_token():
    # Prefer the project file; fall back to the process environment.
    env_file = Path(__file__).resolve().parent.parent / ".env"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8-sig").splitlines():
            key, separator, value = line.partition("=")
            if separator and key.strip() == "TMDB_READ_ACCESS_TOKEN":
                token = value.strip().strip('"').strip("'")
                if token:
                    return token
    return os.environ.get("TMDB_READ_ACCESS_TOKEN", "").strip()


TOKEN = read_token()


def get(path, params=None):
    url = BASE_URL + path
    if params:
        url += "?" + urlencode(params)
    request = Request(url, headers={"Authorization": "Bearer " + TOKEN, "Accept": "application/json"})
    print(f"\nLooking for: GET {path}" + (f" with {params}" if params else ""), flush=True)
    try:
        with urlopen(request, timeout=15) as response:
            data = json.load(response)
            if path.startswith("/search/"):
                summary = {"total_results": data.get("total_results"), "first_results": [
                    {"id": item.get("id"), "title": item.get("title") or item.get("name")}
                    for item in data.get("results", [])[:5]
                ]}
            elif path.endswith("/watch/providers"):
                regions = data.get("results", {})
                us = regions.get("US", {})
                summary = {"id": data.get("id"), "countries_available": len(regions),
                           "US": {category: [p.get("provider_name") for p in us.get(category, [])]
                                  for category in ("flatrate", "rent", "buy")},
                           "US_link": us.get("link")}
            elif "/season/" in path:
                episodes = data.get("episodes", [])
                summary = {"name": data.get("name"), "episode_count": len(episodes),
                           "first_episode": {k: episodes[0].get(k) for k in ("episode_number", "name")}
                           if episodes else None}
            else:
                summary = {k: data.get(k) for k in ("id", "title", "name", "overview", "runtime")
                           if k in data}
            print("TMDB returned: " + json.dumps(summary, ensure_ascii=True), flush=True)
            return data
    except HTTPError as exc:
        raise AssertionError(f"TMDB returned HTTP {exc.code} for {path}") from exc
    except URLError as exc:
        raise AssertionError(f"Could not reach TMDB for {path}: {exc.reason}") from exc


@unittest.skipUnless(TOKEN, "Set TMDB_READ_ACCESS_TOKEN in .env or the environment to run live API checks")
class TmdbSmokeTests(unittest.TestCase):
    def test_movie_search_and_details(self):
        results = get("/search/movie", {"query": "The Matrix"})["results"]
        movie = next((item for item in results if item["id"] == 603), None)
        self.assertIsNotNone(movie, "Expected The Matrix in search results")
        details = get("/movie/603")
        self.assertEqual(details["id"], 603)
        self.assertTrue(details["title"])
        self.assertIn("overview", details)
        self.assertIn("runtime", details)

    def test_tv_search_details_and_episodes(self):
        results = get("/search/tv", {"query": "Breaking Bad"})["results"]
        self.assertTrue(any(item["id"] == 1396 for item in results))
        details = get("/tv/1396")
        self.assertEqual(details["id"], 1396)
        self.assertTrue(details["name"])
        season = get("/tv/1396/season/1")
        self.assertTrue(season["episodes"])
        self.assertEqual(season["episodes"][0]["episode_number"], 1)

    def test_breaking_bad_streaming_and_poster(self):
        providers = get("/tv/1396/watch/providers")
        us = providers.get("results", {}).get("US", {})
        streaming = us.get("flatrate", [])
        self.assertIsInstance(streaming, list)
        for provider in streaming:
            self.assertTrue(provider.get("provider_name"))
        names = [provider["provider_name"] for provider in streaming]
        print("\nBreaking Bad US subscription streaming: " +
              (", ".join(names) if names else "No subscription providers reported"), flush=True)
        print("Availability can change; missing US data is a valid response.", flush=True)

        details = get("/tv/1396")
        poster_path = details.get("poster_path")
        self.assertTrue(poster_path, "Breaking Bad has no poster path")
        config = get("/configuration")
        images = config["images"]
        self.assertIn("w500", images["poster_sizes"])
        poster_url = images["secure_base_url"] + "w500/" + poster_path.lstrip("/")
        print(f"Looking for: Breaking Bad poster at {poster_url}", flush=True)
        try:
            with urlopen(Request(poster_url, headers={"Accept": "image/*"}), timeout=15) as response:
                content_type = response.headers.get_content_type()
                image_data = response.read()
                print(f"TMDB returned: HTTP {response.status}, {content_type}, {len(image_data)} bytes", flush=True)
                self.assertEqual(response.status, 200)
                self.assertTrue(content_type.startswith("image/"), "Response is not an image")
                self.assertGreater(len(image_data), 0, "Poster image is empty")
        except (HTTPError, URLError) as exc:
            self.fail(f"Could not retrieve Breaking Bad poster: {exc}")

    def test_watch_provider_response(self):
        for kind, title_id in (("movie", 603), ("tv", 1396)):
            with self.subTest(kind=kind):
                data = get(f"/{kind}/{title_id}/watch/providers")
                self.assertEqual(data["id"], title_id)
                self.assertIsInstance(data["results"], dict)
                # Availability changes; an empty country list is valid.
                for country, availability in data["results"].items():
                    self.assertIsInstance(country, str)
                    self.assertIsInstance(availability, dict)
                    if "link" in availability:
                        self.assertTrue(availability["link"].startswith("https://"))
                    for category in ("flatrate", "rent", "buy"):
                        if category in availability:
                            self.assertIsInstance(availability[category], list)
                            for provider in availability[category]:
                                self.assertIn("provider_id", provider)
                                self.assertTrue(provider.get("provider_name"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
