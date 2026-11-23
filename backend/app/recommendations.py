"""Rank recommendations using genres, favorite titles and favorite people."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from functools import partial
from typing import Iterable, Sequence

from fastapi import APIRouter, Depends, Query

from app.accounts import current_user, preference_store
from app.auth import AuthenticatedUser
from app.catalog import SERVICE_IDS, summarize, tmdb_get
from app.errors import APIError
from app.favorite_people import Config, favorite_connection
from app.library import PostgresLibraryStore, library_store
from app.preferences import PostgresPreferenceStore
from app.settings import Settings

router = APIRouter(prefix="/api/me", tags=["recommendations"])

MAX_TMDB_CALLS = 6
MAX_WORKERS = MAX_TMDB_CALLS
MAX_PEOPLE_LOOKUPS = 3
MAX_INFERRED_PAGES = 3

GENRE_IDS: dict[str, dict[str, int]] = {
    "movie": {
        "Action": 28, "Animation": 16, "Comedy": 35, "Documentary": 99, "Drama": 18,
        "Fantasy": 14, "Horror": 27, "Romance": 10749, "Science Fiction": 878, "Thriller": 53,
    },
    "tv": {
        "Action": 10759, "Animation": 16, "Comedy": 35, "Documentary": 99, "Drama": 18,
        "Fantasy": 10765, "Science Fiction": 10765,
    },
}
EXCLUDED_STATUSES = {"movie": {"watched"}, "tv": {"completed", "dropped"}}


def excluded_titles(rows: Iterable[dict]) -> set[tuple[str, int]]:
    return {(row["media_type"], row["tmdb_id"]) for row in rows
            if row["status"] in EXCLUDED_STATUSES[row["media_type"]]}


def genre_requests(genres: list[str]) -> list[tuple[str, str, int]]:
    """Pick the discover pages to fetch, de-duplicated and capped."""
    requests: list[tuple[str, str, int]] = []
    seen: set[tuple[str, int]] = set()
    for genre in genres:
        for media_type, mapping in GENRE_IDS.items():
            genre_id = mapping.get(genre)
            if genre_id is None or (media_type, genre_id) in seen:
                continue
            seen.add((media_type, genre_id))
            requests.append((media_type, genre, genre_id))
    return requests[:MAX_TMDB_CALLS]


def fetch_discover_page(request: tuple[str, str, int | None], providers: str) -> tuple[str, str, int | None, dict] | None:
    """Fetch one discover page; a failed page is skipped rather than fatal."""
    media_type, genre, genre_id = request
    params: dict[str, str | int] = {"sort_by": "popularity.desc", "vote_count.gte": 50, "include_adult": "false"}
    if genre_id is not None:
        params["with_genres"] = genre_id
    if providers:
        params.update(watch_region="US", with_watch_providers=providers, with_watch_monetization_types="flatrate")
    try:
        data = tmdb_get(f"/discover/{media_type}", params)
    except APIError:
        return None
    return media_type, genre, genre_id, data if isinstance(data, dict) else {}


def fetch_discover_pages(requests: Sequence[tuple[str, str, int | None]], providers: str) -> list[tuple[str, str, int | None, dict]]:
    if not requests:
        return []
    with ThreadPoolExecutor(max_workers=min(MAX_WORKERS, len(requests))) as pool:
        pages = list(pool.map(partial(fetch_discover_page, providers=providers), requests))
    return [page for page in pages if page is not None]


def favorite_signals(user: AuthenticatedUser, settings: Settings) -> tuple[list[dict], list[dict]]:
    if not settings.database_url:
        return [], []
    try:
        with favorite_connection(settings, user) as conn:
            titles = conn.execute("""
                select media_type, tmdb_id, name, genre_ids from public.favorite_titles
                where user_id = %s order by created_at desc, media_type, tmdb_id
            """, (user.id,)).fetchall()
            people = conn.execute("""
                select tmdb_person_id as id, name from public.favorite_people
                where user_id = %s order by created_at desc, tmdb_person_id desc limit %s
            """, (user.id, MAX_PEOPLE_LOOKUPS)).fetchall()
    except APIError:
        return [], []
    return titles, people


def title_genres(titles: list[dict]) -> dict[tuple[str, int], list[str]]:
    seeds: dict[tuple[str, int], list[str]] = {}
    for title in titles:
        for genre_id in title["genre_ids"]:
            seeds.setdefault((title["media_type"], genre_id), []).append(title["name"])
    return seeds


def person_candidates(person: dict) -> tuple[str, dict[tuple[str, int], dict]]:
    try:
        credits = tmdb_get(f"/person/{person['id']}/combined_credits")
    except APIError:
        return person["name"], {}
    acting = credits.get("cast") or []
    directing = [credit for credit in credits.get("crew") or [] if credit.get("job") == "Director"]
    items = {}
    for item in [*acting, *directing]:
        media_type = item.get("media_type")
        if media_type in ("movie", "tv") and item.get("id") and not item.get("adult"):
            if summarize(item, media_type)["name"]:
                items.setdefault((media_type, item["id"]), item)
    return person["name"], items


@router.get("/recommendations")
def read_recommendations(settings: Config, limit: int = Query(default=12, ge=1, le=20),
                         streaming_only: bool = False,
                         user: AuthenticatedUser = Depends(current_user),
                         preferences: PostgresPreferenceStore = Depends(preference_store),
                         library: PostgresLibraryStore = Depends(library_store)) -> dict:
    choices = preferences.get(user.id)
    genres = choices["favorite_genres"]
    providers = ""
    if streaming_only:
        provider_ids = {provider for service in choices["streaming_services"] for provider in SERVICE_IDS.get(service, set())}
        if not provider_ids:
            raise APIError(422, "no_streaming_services", "Choose streaming services in Account before filtering.")
        providers = "|".join(map(str, sorted(provider_ids)))
    excluded = excluded_titles(library.list(user.id, None, None))
    favorite_titles, favorite_people = favorite_signals(user, settings)
    excluded.update((title["media_type"], title["tmdb_id"]) for title in favorite_titles)
    inferred_genres = title_genres(favorite_titles)

    scores: dict[tuple[str, int], int] = {}
    candidates: dict[tuple[str, int], dict] = {}
    reasons: dict[tuple[str, int], str] = {}
    candidate_genres: dict[tuple[str, int], set[int]] = {}
    favorite_reasons: dict[tuple[str, int], str] = {}

    if genres or providers or inferred_genres:
        manual = genre_requests(genres)
        manual_keys = {(media_type, genre_id) for media_type, _, genre_id in manual}
        inferred = [(media_type, "", genre_id)
                    for media_type, genre_id in sorted(inferred_genres, key=lambda key: -len(inferred_genres[key]))
                    if (media_type, genre_id) not in manual_keys][:MAX_INFERRED_PAGES]
        requests: list[tuple[str, str, int | None]] = [*manual[:MAX_TMDB_CALLS - len(inferred)], *inferred]
        if providers and not genres:
            requests.extend([("movie", "", None), ("tv", "", None)])
        pages = fetch_discover_pages(requests, providers)
        if not pages and (providers or (genres and not favorite_people)):
            raise APIError(503, "recommendations_unavailable",
                           "Recommendations are unavailable right now. Try again.")
        for media_type, genre, genre_id, data in pages:
            for item in data.get("results", []):
                if not isinstance(item, dict) or item.get("id") is None:
                    continue
                key = (media_type, int(item["id"]))
                if key in excluded:
                    continue
                scores[key] = scores.get(key, 0) + int(bool(genre))
                candidates.setdefault(key, item)
                ids = candidate_genres.setdefault(key, set())
                ids.update(item.get("genre_ids") or [])
                if genre_id is not None:
                    ids.add(genre_id)
                if genre:
                    reasons.setdefault(key, genre)
        basis = "genres" if genres else "popular"
    else:
        basis = "popular"

    if favorite_people:
        with ThreadPoolExecutor(max_workers=MAX_PEOPLE_LOOKUPS) as pool:
            for name, matches in pool.map(person_candidates, favorite_people[:MAX_PEOPLE_LOOKUPS]):
                for key, item in matches.items():
                    if key in excluded or (providers and key not in candidates):
                        continue
                    scores[key] = scores.get(key, 0) + 1
                    candidates.setdefault(key, item)
                    candidate_genres.setdefault(key, set()).update(item.get("genre_ids") or [])
                    favorite_reasons.setdefault(key, name)

    for key, ids in candidate_genres.items():
        for genre_id in sorted(ids):
            matches = inferred_genres.get((key[0], genre_id))
            if matches:
                scores[key] += len(matches)
                favorite_reasons.setdefault(key, matches[0])

    if favorite_reasons:
        basis = "favorites"
        reasons.update(favorite_reasons)
    if not candidates and not providers and (not genres or favorite_people):
        data = tmdb_get("/trending/all/week")
        for item in data.get("results", []):
            if not isinstance(item, dict) or item.get("media_type") not in ("movie", "tv"):
                continue
            key = (item["media_type"], int(item["id"]))
            if key in excluded:
                continue
            candidates[key] = item
            scores[key] = 1
        basis = "popular"

    ordered = sorted(candidates, key=lambda key: (-scores[key], -(candidates[key].get("popularity") or 0)))
    items = []
    for key in ordered[:limit]:
        media_type, _ = key
        summary = summarize(candidates[key], media_type)
        items.append({**summary, "reason": reasons.get(key)})
    return {"items": items, "basis": basis}
