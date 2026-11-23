"""Public movie and TV discovery backed by TMDB."""

import logging
import os
import time
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from threading import Lock
from typing import Literal

import httpx
from fastapi import APIRouter, Depends, Query

from app.accounts import current_user, preference_store
from app.auth import AuthenticatedUser
from app.errors import APIError
from app.preferences import PreferenceStore

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/catalog", tags=["catalog"])
filtered_router = APIRouter(prefix="/api/me/catalog", tags=["catalog"])

SERVICE_IDS = {"Netflix": {8}, "Hulu": {15}, "Disney+": {337}, "Apple TV+": {350}, "Max": {384, 1899}}
SERVICE_NAMES = {"Netflix": {"netflix"}, "Hulu": {"hulu"}, "Disney+": {"disney plus", "disney+"},
                 "Apple TV+": {"apple tv plus", "apple tv+"}, "Max": {"max", "hbo max"}}
TMDB_BASE = "https://api.themoviedb.org/3"
MediaType = Literal["movie", "tv"]

_TMDB_CACHE_TTL_SECONDS = 600.0
_TMDB_CACHE_MAX_ENTRIES = 512
_tmdb_cache: OrderedDict[tuple, tuple[float, dict]] = OrderedDict()
_tmdb_cache_lock = Lock()
_tmdb_client_lock = Lock()
_tmdb_client: httpx.Client | None = None


def _get_client() -> httpx.Client:
    global _tmdb_client
    with _tmdb_client_lock:
        if _tmdb_client is None or _tmdb_client.is_closed:
            _tmdb_client = httpx.Client(
                base_url=TMDB_BASE,
                timeout=10.0,
                headers={"Accept": "application/json"},
            )
        return _tmdb_client


def close_tmdb_client() -> None:
    global _tmdb_client
    with _tmdb_client_lock:
        if _tmdb_client is not None and not _tmdb_client.is_closed:
            _tmdb_client.close()
        _tmdb_client = None


def clear_tmdb_cache() -> None:
    with _tmdb_cache_lock:
        _tmdb_cache.clear()


def _cache_key(path: str, params: dict | None) -> tuple:
    items = tuple(sorted((str(k), str(v)) for k, v in (params or {}).items()))
    return (path, items)


def tmdb_get(path: str, params: dict | None = None) -> dict:
    token = os.environ.get("TMDB_READ_ACCESS_TOKEN", "").strip()
    if not token:
        raise APIError(503, "catalog_unavailable", "Movie and TV discovery is not configured.")

    key = _cache_key(path, params)
    now = time.monotonic()
    with _tmdb_cache_lock:
        cached = _tmdb_cache.get(key)
        if cached is not None:
            expires_at, payload = cached
            if expires_at > now:
                _tmdb_cache.move_to_end(key)
                return payload
            _tmdb_cache.pop(key, None)

    try:
        response = _get_client().get(
            path,
            params=params,
            headers={"Authorization": f"Bearer {token}"},
        )
        response.raise_for_status()
        data = response.json()
    except httpx.HTTPStatusError as exc:
        status_code = exc.response.status_code
        if status_code == 404:
            raise APIError(404, "title_not_found", "This title could not be found.") from exc
        if status_code == 429:
            logger.warning("TMDB rate limit hit on %s", path)
            raise APIError(503, "catalog_rate_limited", "Movie and TV data is busy. Please try again later.") from exc
        logger.warning("TMDB upstream HTTP %s on %s", status_code, path)
        raise APIError(502, "catalog_upstream_error", "Movie and TV data is unavailable. Please try again.") from exc
    except (httpx.HTTPError, ValueError) as exc:
        logger.exception("TMDB request failed for %s", path)
        raise APIError(503, "catalog_unavailable", "Movie and TV data is unavailable. Please try again.") from exc

    if not isinstance(data, dict):
        raise APIError(502, "catalog_upstream_error", "Movie and TV data could not be read.")

    with _tmdb_cache_lock:
        _tmdb_cache[key] = (now + _TMDB_CACHE_TTL_SECONDS, data)
        _tmdb_cache.move_to_end(key)
        while len(_tmdb_cache) > _TMDB_CACHE_MAX_ENTRIES:
            _tmdb_cache.popitem(last=False)
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


@router.get("/trending")
def trending() -> dict:
    data = tmdb_get("/trending/all/week")
    titles = [
        {**summarize(item, item["media_type"]), "backdrop_path": item.get("backdrop_path")}
        for item in data.get("results", [])
        if isinstance(item, dict)
        and item.get("media_type") in ("movie", "tv")
        and item.get("id") is not None
        and not item.get("adult")
    ]
    return {"items": titles[:6]}


@router.get("/search")
def search(query: str = Query(min_length=1, max_length=200),
           page: int = Query(default=1, ge=1, le=500),
           media_type: Literal["movie", "tv"] | None = None) -> dict:
    query = query.strip()
    if not query:
        raise APIError(422, "invalid_query", "Enter a title to search.")
    data = tmdb_get(f"/search/{media_type or 'multi'}", {"query": query, "page": page, "include_adult": "false"})
    return {
        "items": [summarize(item, media_type or item["media_type"]) for item in data.get("results", [])
                  if isinstance(item, dict) and (media_type or item.get("media_type") in ("movie", "tv"))],
        "page": data.get("page", page),
        "total_pages": data.get("total_pages", 0),
    }


@filtered_router.get("/search")
def search_available(query: str = Query(min_length=1, max_length=200), page: int = Query(default=1, ge=1, le=500),
                     user: AuthenticatedUser = Depends(current_user),
                     preferences: PreferenceStore = Depends(preference_store),
                     media_type: Literal["movie", "tv"] | None = None) -> dict:
    selected = preferences.get(user.id)["streaming_services"]
    if not selected:
        raise APIError(422, "no_streaming_services", "Choose streaming services in Account before filtering.")
    data = search(query, page, media_type)

    def available(item: dict) -> bool:
        providers = tmdb_get(f"/{item['media_type']}/{item['id']}/watch/providers")
        region = providers.get("results", {}).get("US", {})
        for provider in region.get("flatrate", []):
            if not isinstance(provider, dict):
                continue
            provider_id = provider.get("provider_id")
            name = str(provider.get("provider_name") or "").casefold().strip()
            if any(provider_id in SERVICE_IDS.get(service, set()) or name in SERVICE_NAMES.get(service, set()) for service in selected):
                return True
        return False

    items = data["items"]
    # TMDB multi-search pages contain at most 20 results; limit concurrent lookups.
    with ThreadPoolExecutor(max_workers=5) as pool:
        matches = list(pool.map(available, items))
    return {**data, "items": [item for item, match in zip(items, matches) if match],
            "availability_region": "US", "filtered_by_services": True}


@router.get("/people/search")
def search_people(query: str = Query(min_length=1, max_length=200),
                  page: int = Query(default=1, ge=1, le=500)) -> dict:
    query = query.strip()
    if not query:
        raise APIError(422, "invalid_query", "Enter a name to search.")
    data = tmdb_get("/search/person", {"query": query, "page": page, "include_adult": "false"})
    fields = ("id", "name", "profile_path", "known_for_department")
    items = []
    for person in data.get("results", []):
        if not isinstance(person, dict) or not person.get("id") or not person.get("name") or person.get("adult"):
            continue
        titles = [title.get("title") or title.get("name") for title in person.get("known_for") or []
                  if isinstance(title, dict) and not title.get("adult")]
        items.append({**{field: person.get(field) for field in fields},
                      "known_for": list(dict.fromkeys(title for title in titles if title))[:2]})
    return {"items": items, "page": data.get("page", page), "total_pages": data.get("total_pages", 0)}


@router.get("/people/{person_id}")
def person_details(person_id: int) -> dict:
    if not 0 < person_id <= 2147483647:
        raise APIError(422, "invalid_person", "Invalid TMDB person ID.")
    data = tmdb_get(f"/person/{person_id}")
    if data.get("id") != person_id or not data.get("name") or data.get("adult"):
        raise APIError(404, "person_not_found", "This person could not be found.")
    return {field: data.get(field) for field in
            ("id", "name", "profile_path", "biography", "birthday", "deathday", "place_of_birth")}


@router.get("/people/{person_id}/credits")
def person_credits(person_id: int, role: Literal["acting", "creator", "director"] = "acting") -> dict:
    if person_id <= 0:
        raise APIError(422, "invalid_person", "Person IDs must be positive.")
    data = tmdb_get(f"/person/{person_id}/combined_credits")
    titles = {}
    credits = data.get("cast" if role == "acting" else "crew") or []
    crew_jobs = {"creator": {"Creator", "Created By"}, "director": {"Director"}}
    for credit in credits:
        media_type = credit.get("media_type")
        if media_type not in ("movie", "tv") or credit.get("id") is None or credit.get("adult"):
            continue
        if role != "acting" and credit.get("job") not in crew_jobs[role]:
            continue
        title = summarize(credit, media_type)
        if not title["name"]:
            continue
        key = (media_type, title["id"])
        entry = titles.setdefault(key, {**title, "characters": [], "popularity": credit.get("popularity") or 0})
        character = credit.get("character") if role == "acting" else None
        if character and character not in entry["characters"]:
            entry["characters"].append(character)
    return {"items": sorted(titles.values(), key=lambda title: title["release_date"] or "", reverse=True)}


def credited_people(people: list[dict]) -> list[dict]:
    credits = {}
    for person in people:
        if person.get("id") is not None and person.get("name"):
            credits.setdefault(person["id"], {
                "id": person["id"], "name": person["name"], "profile_path": person.get("profile_path"),
            })
    return list(credits.values())


def directors(crew: list[dict]) -> list[dict]:
    return credited_people([person for person in crew if person.get("job") == "Director"])


@router.get("/{media_type}/{tmdb_id}")
def title_details(media_type: MediaType, tmdb_id: int) -> dict:
    if tmdb_id <= 0:
        raise APIError(422, "invalid_title", "Title IDs must be positive.")
    credits_key = "aggregate_credits" if media_type == "tv" else "credits"
    append = f"watch/providers,{credits_key}"
    data = tmdb_get(f"/{media_type}/{tmdb_id}", {"append_to_response": append})
    credits = data.get(credits_key) or {}
    providers = data.get("watch/providers")
    if not isinstance(providers, dict):
        providers = tmdb_get(f"/{media_type}/{tmdb_id}/watch/providers")
    availability = providers.get("results", {}).get("US", {})
    return {
        **summarize(data, media_type),
        "runtime": data.get("runtime") if media_type == "movie" else None,
        "genres": [genre.get("name") for genre in data.get("genres", []) if genre.get("name")],
        "creators": credited_people(data.get("created_by") or []) if media_type == "tv" else [],
        "directors": directors(credits.get("crew") or []) if media_type == "movie" else [],
        "seasons": [{"season_number": season.get("season_number"), "name": season.get("name"),
                     "episode_count": season.get("episode_count")} for season in data.get("seasons", [])],
        "cast": [
            {
                "id": actor["id"],
                "name": actor["name"],
                "profile_path": actor.get("profile_path"),
                "characters": list(dict.fromkeys(
                    role["character"] for role in actor.get("roles") or [] if role.get("character")
                )) if media_type == "tv" else ([actor["character"]] if actor.get("character") else []),
            }
            for actor in credits.get("cast") or []
            if actor.get("id") is not None and actor.get("name")
        ],
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
                          "overview": episode.get("overview") or "", "air_date": episode.get("air_date"),
                          "directors": directors(episode.get("crew") or [])}
                         for episode in data.get("episodes", [])]}
