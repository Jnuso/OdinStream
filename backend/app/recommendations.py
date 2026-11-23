"""Rank recommendations using genres, favorite titles and favorite people."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from functools import partial
from typing import Iterable, Sequence

from fastapi import APIRouter, Depends, Query

from app.accounts import current_user, preference_store
from app.auth import AuthenticatedUser
from app.catalog import streaming_provider_ids, summarize, tmdb_get
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
MAX_TITLE_SEEDS = 3
MAX_MATCHES_PER_SEED = 8
MAX_CANDIDATE_RATINGS = 24
CHILDREN_GENRE = 10762
AUDIENCE_RATINGS = {
    "tv": {"TV-Y": 0, "TV-Y7": 0, "TV-Y7-FV": 0, "TV-G": 0, "TV-PG": 1, "TV-14": 2, "TV-MA": 2},
    "movie": {"G": 0, "PG": 1, "PG-13": 2, "R": 2, "NC-17": 2},
}

GENRE_IDS: dict[str, dict[str, int]] = {
    "movie": {
        "Action": 28, "Adventure": 12, "Animation": 16, "Comedy": 35, "Crime": 80,
        "Documentary": 99, "Drama": 18, "Family": 10751, "Fantasy": 14, "History": 36,
        "Horror": 27, "Music": 10402, "Mystery": 9648, "Romance": 10749,
        "Science Fiction": 878, "Thriller": 53, "TV Movie": 10770, "War": 10752, "Western": 37,
    },
    "tv": {
        "Action & Adventure": 10759, "Animation": 16, "Comedy": 35, "Crime": 80,
        "Documentary": 99, "Drama": 18, "Family": 10751, "Kids": 10762, "Mystery": 9648,
        "News": 10763, "Reality": 10764, "Sci-Fi & Fantasy": 10765, "Soap": 10766,
        "Talk": 10767, "War & Politics": 10768, "Western": 37,
        # Keep the existing TV matches for previously supported broad selections.
        "Action": 10759, "Fantasy": 10765, "Science Fiction": 10765,
    },
}
def excluded_titles(rows: Iterable[dict]) -> set[tuple[str, int]]:
    return {(row["media_type"], row["tmdb_id"]) for row in rows}


def audience(media_type: str, genre_ids: Iterable[int], metadata: dict) -> int | None:
    if CHILDREN_GENRE in genre_ids:
        return 0
    region_key = "iso_3166_1"
    ratings = []
    for region in metadata.get("results") or []:
        if region.get(region_key) != "US":
            continue
        if media_type == "tv":
            ratings.append(region.get("rating"))
        else:
            ratings.extend(release.get("certification") for release in region.get("release_dates") or [])
    return max((AUDIENCE_RATINGS[media_type][rating] for rating in ratings
                if rating in AUDIENCE_RATINGS[media_type]), default=None)


def rating_metadata(key: tuple[str, int]) -> dict:
    media_type, title_id = key
    endpoint = "content_ratings" if media_type == "tv" else "release_dates"
    try:
        return tmdb_get(f"/{media_type}/{title_id}/{endpoint}")
    except APIError:
        return {}


def title_candidates(seed: dict) -> list[dict]:
    try:
        data = tmdb_get(f"/{seed['media_type']}/{seed['tmdb_id']}/recommendations")
    except APIError:
        return []
    return [item for item in data.get("results") or []
            if isinstance(item, dict) and item.get("id") and not item.get("adult")][:MAX_MATCHES_PER_SEED]


def available_on_services(key: tuple[str, int], provider_ids: set[int]) -> bool:
    try:
        data = tmdb_get(f"/{key[0]}/{key[1]}/watch/providers")
    except APIError:
        return False
    providers = (data.get("results") or {}).get("US", {}).get("flatrate") or []
    return any(provider.get("provider_id") in provider_ids for provider in providers)


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
    provider_ids: set[int] = set()
    if streaming_only:
        provider_ids = streaming_provider_ids(choices["streaming_services"])
        if not provider_ids:
            raise APIError(422, "no_streaming_services", "Choose streaming services in Account before filtering.")
        providers = "|".join(map(str, sorted(provider_ids)))
    excluded = excluded_titles(library.list(user.id, None, None))
    favorite_titles, favorite_people = favorite_signals(user, settings)
    excluded.update((title["media_type"], title["tmdb_id"]) for title in favorite_titles)
    seeds = favorite_titles[:MAX_TITLE_SEEDS]
    inferred_genres = title_genres(seeds)

    scores: dict[tuple[str, int], int] = {}
    candidates: dict[tuple[str, int], dict] = {}
    reasons: dict[tuple[str, int], str] = {}
    candidate_genres: dict[tuple[str, int], set[int]] = {}
    favorite_reasons: dict[tuple[str, int], str] = {}
    direct_matches: dict[tuple[str, int], set[int]] = {}
    best_title_signal: dict[tuple[str, int], int] = {}
    pages = []

    if seeds:
        with ThreadPoolExecutor(max_workers=MAX_TITLE_SEEDS) as pool:
            for index, matches in enumerate(pool.map(title_candidates, seeds)):
                for item in matches:
                    key = (seeds[index]["media_type"], int(item["id"]))
                    if key in excluded:
                        continue
                    direct_matches.setdefault(key, set()).add(index)
                    candidates.setdefault(key, item)
                    candidate_genres.setdefault(key, set()).update(item.get("genre_ids") or [])
                    scores.setdefault(key, 0)

    if genres or providers or inferred_genres:
        manual = genre_requests(genres)
        manual_keys = {(media_type, genre_id) for media_type, _, genre_id in manual}
        inferred = [(media_type, "", genre_id)
                    for media_type, genre_id in sorted(inferred_genres, key=lambda key: -len(inferred_genres[key]))
                    if (media_type, genre_id) not in manual_keys][:MAX_INFERRED_PAGES]
        requests: list[tuple[str, str, int | None]] = [*manual[:MAX_TMDB_CALLS - len(inferred)], *inferred]
        if providers and not genres and not inferred:
            requests.extend([("movie", "", None), ("tv", "", None)])
        pages = fetch_discover_pages(requests, providers)
        for media_type, genre, genre_id, data in pages:
            for item in data.get("results", []):
                if not isinstance(item, dict) or item.get("id") is None:
                    continue
                key = (media_type, int(item["id"]))
                if key in excluded or item.get("adult"):
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

    if providers and direct_matches:
        filtered_keys = {(media_type, item["id"]) for media_type, _, _, data in pages
                         for item in data.get("results", []) if isinstance(item, dict) and item.get("id")}
        unverified = [key for key in direct_matches if key not in filtered_keys]
        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
            available = pool.map(partial(available_on_services, provider_ids=provider_ids), unverified)
            for key, match in zip(unverified, available):
                if not match:
                    candidates.pop(key)
                    candidate_genres.pop(key)
                    scores.pop(key)
                    direct_matches.pop(key)

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

    if seeds:
        seed_keys = [(seed["media_type"], seed["tmdb_id"]) for seed in seeds]
        seed_genres = [set(seed["genre_ids"]) for seed in seeds]
        title_signals = {
            key: [(index, index in direct_matches.get(key, ()), len(ids & genres_for_seed))
                  for index, (seed_key, genres_for_seed) in enumerate(zip(seed_keys, seed_genres))
                  if key[0] == seed_key[0] and (index in direct_matches.get(key, ()) or ids & genres_for_seed)]
            for key, ids in candidate_genres.items()
        }
        rating_candidates = sorted(
            (key for key, signals in title_signals.items() if signals),
            key=lambda key: (bool(direct_matches.get(key)), scores[key],
                             max(overlap for _, _, overlap in title_signals[key]),
                             candidates[key].get("popularity") or 0),
            reverse=True,
        )[:MAX_CANDIDATE_RATINGS]
        rating_keys = [*seed_keys, *rating_candidates]
        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
            metadata = dict(zip(rating_keys, pool.map(rating_metadata, rating_keys)))
        seed_audiences = [audience(key[0], ids, metadata[key]) for key, ids in zip(seed_keys, seed_genres)]

        for key, signals in title_signals.items():
            candidate_audience = audience(key[0], candidate_genres[key], metadata.get(key, {}))
            for index, direct, overlap in signals:
                seed_audience = seed_audiences[index]
                mismatch = (seed_audience is not None and candidate_audience is not None
                            and abs(seed_audience - candidate_audience) == 2)
                if mismatch:
                    # Keep the weak relation below relevant matches without
                    # penalizing a match to a different favorite.
                    favorite_reasons.setdefault(key, seeds[index]["name"])
                    continue
                same_audience = seed_audience is not None and seed_audience == candidate_audience
                strength = (6 if direct else 0) + overlap + int(same_audience)
                scores[key] += strength
                if strength > best_title_signal.get(key, 0):
                    best_title_signal[key] = strength
                    favorite_reasons[key] = seeds[index]["name"]

    if not candidates and not pages and (providers or genres):
        raise APIError(503, "recommendations_unavailable",
                       "Recommendations are unavailable right now. Try again.")

    if favorite_reasons:
        basis = "favorites"
        reasons.update(favorite_reasons)
    if not candidates and not providers and not genres:
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

    if genres or favorite_titles or favorite_people:
        candidates = {key: item for key, item in candidates.items() if key in reasons or basis == "popular"}
    ordered = sorted(candidates, key=lambda key: (-scores[key], -(candidates[key].get("popularity") or 0)))
    items = []
    for key in ordered[:limit]:
        media_type, _ = key
        summary = summarize(candidates[key], media_type)
        items.append({**summary, "reason": reasons.get(key)})
    return {"items": items, "basis": basis}
