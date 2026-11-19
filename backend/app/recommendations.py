"""Explainable recommendations from favorite genres and library history.

Ranking is deliberately simple: every candidate title scores once for each of
the viewer's favorite genres that produced it, with TMDB popularity as the
tie-break. Titles already watched (movies) or completed/dropped (shows) are
excluded. A viewer without favorite genres gets popular titles instead.

TMDB work is bounded: at most ``MAX_TMDB_CALLS`` discover pages are fetched per
request (deduplicated by media type and genre id) and they run concurrently in a
small thread pool, so a page load cannot turn into a long sequential crawl.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from functools import partial
from typing import Iterable, Sequence

from fastapi import APIRouter, Depends, Query

from app.accounts import current_user, preference_store
from app.auth import AuthenticatedUser
from app.catalog import SERVICE_IDS, summarize, tmdb_get
from app.errors import APIError
from app.library import PostgresLibraryStore, library_store
from app.preferences import PostgresPreferenceStore

router = APIRouter(prefix="/api/me", tags=["recommendations"])

MAX_TMDB_CALLS = 6
MAX_WORKERS = MAX_TMDB_CALLS

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


def fetch_discover_page(request: tuple[str, str, int | None], providers: str) -> tuple[str, str, dict] | None:
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
    return media_type, genre, data if isinstance(data, dict) else {}


def fetch_discover_pages(requests: Sequence[tuple[str, str, int | None]], providers: str) -> list[tuple[str, str, dict]]:
    if not requests:
        return []
    with ThreadPoolExecutor(max_workers=min(MAX_WORKERS, len(requests))) as pool:
        pages = list(pool.map(partial(fetch_discover_page, providers=providers), requests))
    return [page for page in pages if page is not None]


@router.get("/recommendations")
def read_recommendations(limit: int = Query(default=12, ge=1, le=20),
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

    scores: dict[tuple[str, int], int] = {}
    candidates: dict[tuple[str, int], dict] = {}
    reasons: dict[tuple[str, int], str] = {}

    if genres or providers:
        requests: Sequence[tuple[str, str, int | None]] = genre_requests(genres) if genres else [
            ("movie", "", None), ("tv", "", None),
        ]
        pages = fetch_discover_pages(requests, providers)
        if not pages:
            raise APIError(503, "recommendations_unavailable",
                           "Recommendations are unavailable right now. Try again.")
        for media_type, genre, data in pages:
            for item in data.get("results", []):
                if not isinstance(item, dict) or item.get("id") is None:
                    continue
                key = (media_type, int(item["id"]))
                if key in excluded:
                    continue
                scores[key] = scores.get(key, 0) + 1
                candidates.setdefault(key, item)
                if genre:
                    reasons.setdefault(key, genre)
        basis = "genres" if genres else "popular"
    else:
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
