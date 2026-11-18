"""Public movie and TV discovery backed by TMDB."""

import json
import os
from typing import Literal
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from fastapi import APIRouter, Query

from app.errors import APIError

router = APIRouter(prefix="/api/catalog", tags=["catalog"])
TMDB_BASE = "https://api.themoviedb.org/3"
MediaType = Literal["movie", "tv"]


def tmdb_get(path: str, params: dict | None = None) -> dict:
    token = os.environ.get("TMDB_READ_ACCESS_TOKEN", "").strip()
    if not token:
        raise APIError(503, "catalog_unavailable", "Movie and TV discovery is not configured.")
    url = TMDB_BASE + path
    if params:
        url += "?" + urlencode(params)
    request = Request(url, headers={"Authorization": f"Bearer {token}", "Accept": "application/json"})
    try:
        with urlopen(request, timeout=10) as response:
            data = json.load(response)
    except HTTPError as exc:
        if exc.code == 404:
            raise APIError(404, "title_not_found", "This title could not be found.") from exc
        if exc.code == 429:
            raise APIError(503, "catalog_rate_limited", "Movie and TV data is busy. Please try again later.") from exc
        raise APIError(502, "catalog_upstream_error", "Movie and TV data is unavailable. Please try again.") from exc
    except (URLError, TimeoutError, OSError, ValueError) as exc:
        raise APIError(503, "catalog_unavailable", "Movie and TV data is unavailable. Please try again.") from exc
    if not isinstance(data, dict):
        raise APIError(502, "catalog_upstream_error", "Movie and TV data could not be read.")
    return data


def summarize(item: dict, media_type: str) -> dict:
    return {
        "id": item.get("id"),
        "media_type": media_type,
        "name": item.get("title") if media_type == "movie" else item.get("name"),
        "release_date": item.get("release_date") if media_type == "movie" else item.get("first_air_date"),
        "overview": item.get("overview") or "",
        "poster_path": item.get("poster_path"),
    }


@router.get("/search")
def search(query: str = Query(min_length=1, max_length=200), page: int = Query(default=1, ge=1, le=500)) -> dict:
    query = query.strip()
    if not query:
        raise APIError(422, "invalid_query", "Enter a title to search.")
    data = tmdb_get("/search/multi", {"query": query, "page": page, "include_adult": "false"})
    return {
        "items": [summarize(item, item["media_type"]) for item in data.get("results", [])
                  if isinstance(item, dict) and item.get("media_type") in ("movie", "tv")],
        "page": data.get("page", page),
        "total_pages": data.get("total_pages", 0),
    }


@router.get("/{media_type}/{tmdb_id}")
def title_details(media_type: MediaType, tmdb_id: int) -> dict:
    if tmdb_id <= 0:
        raise APIError(422, "invalid_title", "Title IDs must be positive.")
    data = tmdb_get(f"/{media_type}/{tmdb_id}")
    providers = tmdb_get(f"/{media_type}/{tmdb_id}/watch/providers")
    availability = providers.get("results", {}).get("US", {})
    return {
        **summarize(data, media_type),
        "runtime": data.get("runtime") if media_type == "movie" else None,
        "genres": [genre.get("name") for genre in data.get("genres", []) if genre.get("name")],
        "seasons": [{"season_number": season.get("season_number"), "name": season.get("name"),
                     "episode_count": season.get("episode_count")} for season in data.get("seasons", [])],
        "availability": {
            "link": availability.get("link"),
            **{category: [provider.get("provider_name") for provider in availability.get(category, [])
                          if provider.get("provider_name")] for category in ("flatrate", "rent", "buy")},
        },
    }


@router.get("/tv/{tmdb_id}/seasons/{season_number}")
def season_details(tmdb_id: int, season_number: int) -> dict:
    if tmdb_id <= 0 or season_number < 0:
        raise APIError(422, "invalid_title", "Invalid title or season number.")
    data = tmdb_get(f"/tv/{tmdb_id}/season/{season_number}")
    return {"name": data.get("name"), "season_number": season_number,
            "episodes": [{"episode_number": episode.get("episode_number"), "name": episode.get("name"),
                          "overview": episode.get("overview") or "", "air_date": episode.get("air_date")}
                         for episode in data.get("episodes", [])]}
