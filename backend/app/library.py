"""Authenticated, owner-scoped saved title operations."""

from __future__ import annotations

import logging
from typing import Literal
from uuid import UUID

import psycopg
from fastapi import APIRouter, Depends, Query, Response
from psycopg.rows import dict_row
from pydantic import BaseModel, ConfigDict, Field, StrictInt

from app.accounts import current_user
from app.auth import AuthenticatedUser
from app.catalog import tmdb_get
from app.db import user_connection
from app.errors import APIError
from app.settings import Settings, get_settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/me/saved-titles", tags=["library"])
MediaType = Literal["movie", "tv"]
Status = Literal["watchlist", "watched", "watching", "completed", "paused", "dropped"]
ALLOWED = {"movie": {"watchlist", "watched"},
           "tv": {"watchlist", "watching", "completed", "paused", "dropped"}}
COLUMNS = "id, media_type, tmdb_id, status, created_at, updated_at"


class CreateTitle(BaseModel):
    model_config = ConfigDict(extra="forbid")
    media_type: MediaType
    tmdb_id: StrictInt = Field(gt=0, le=9223372036854775807)
    status: Status


class UpdateTitle(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Status


def validate_status(media_type: str, status: str) -> None:
    if status not in ALLOWED[media_type]:
        raise APIError(422, "invalid_status", "That status is not valid for this type of title.")


class PostgresLibraryStore:
    def __init__(self, database_url: str) -> None:
        self.database_url = database_url

    def run(self, user_id: str, query: str, parameters: tuple, *, many: bool = False):
        try:
            with user_connection(self.database_url, user_id, row_factory=dict_row) as conn:
                cursor = conn.execute(query, parameters)
                return cursor.fetchall() if many else cursor.fetchone()
        except psycopg.errors.UniqueViolation as exc:
            raise APIError(409, "duplicate_title", "This title is already in your library.") from exc
        except psycopg.Error as exc:
            logger.exception("Library database query failed")
            raise APIError(503, "library_unavailable", "Your library is unavailable right now. Try again.") from exc

    def list(self, user_id: str, media_type: str | None, status: str | None, limit: int | None = None, offset: int = 0):
        return self.run(user_id, f"""select {COLUMNS} from public.saved_titles
            where user_id = %s and (%s::text is null or media_type = %s)
              and (%s::text is null or status = %s)
            order by created_at desc, id desc limit %s offset %s""",
            (user_id, media_type, media_type, status, status, limit, offset), many=True)

    def create(self, user_id: str, media_type: str, tmdb_id: int, status: str):
        return self.run(user_id, f"""insert into public.saved_titles (user_id, media_type, tmdb_id, status)
            values (%s, %s, %s, %s) returning {COLUMNS}""", (user_id, media_type, tmdb_id, status))

    def get(self, user_id: str, entry_id: UUID):
        return self.run(user_id, f"select {COLUMNS} from public.saved_titles where user_id = %s and id = %s",
                        (user_id, entry_id))

    def update(self, user_id: str, entry_id: UUID, status: str):
        return self.run(user_id, f"""update public.saved_titles set status = %s
            where user_id = %s and id = %s returning {COLUMNS}""", (status, user_id, entry_id))

    def delete(self, user_id: str, entry_id: UUID):
        return self.run(user_id, "delete from public.saved_titles where user_id = %s and id = %s returning id",
                        (user_id, entry_id))

    def episodes(self, user_id: str, entry_id: UUID):
        return self.run(user_id, """select w.season_number, w.episode_number, w.watch_order
            from public.watched_episodes w join public.saved_titles s
              on s.user_id = w.user_id and s.tmdb_id = w.tmdb_id and s.media_type = 'tv'
            where s.user_id = %s and s.id = %s
            order by w.watch_order desc, w.season_number desc, w.episode_number desc""",
            (user_id, entry_id), many=True)

    def mark_episodes(self, user_id: str, entry_id: UUID, season: int, numbers: list[int], *, bulk: bool = False):
        conflict = "do update set watched_at = excluded.watched_at, watch_order = excluded.watch_order" if bulk else "do nothing"
        return self.run(user_id, f"""insert into public.watched_episodes
            (user_id, tmdb_id, season_number, episode_number, watched_at, watch_order)
            select s.user_id, s.tmdb_id, %s, n, statement_timestamp(), nextval('public.watched_episode_order_seq')
            from public.saved_titles s cross join unnest(%s::integer[]) as n
            where s.user_id = %s and s.id = %s and s.media_type = 'tv' order by n
            on conflict (user_id, tmdb_id, season_number, episode_number) {conflict} returning episode_number""",
            (season, numbers, user_id, entry_id), many=True)

    def unmark_episodes(self, user_id: str, entry_id: UUID, season: int, numbers: list[int] | None = None):
        return self.run(user_id, """delete from public.watched_episodes w using public.saved_titles s
            where s.user_id = %s and s.id = %s and s.media_type = 'tv'
            and w.user_id = s.user_id and w.tmdb_id = s.tmdb_id and w.season_number = %s
            and (%s::integer[] is null or w.episode_number = any(%s::integer[])) returning w.episode_number""",
            (user_id, entry_id, season, numbers, numbers), many=True)


def library_store(settings: Settings = Depends(get_settings)) -> PostgresLibraryStore:
    if not settings.database_url:
        raise APIError(503, "library_unavailable", "Your library is not configured.")
    return PostgresLibraryStore(settings.database_url)


def tv_entry(store: PostgresLibraryStore, user_id: str, entry_id: UUID) -> dict:
    entry = store.get(user_id, entry_id)
    if entry is None:
        raise APIError(404, "title_not_found", "Saved title not found.")
    if entry["media_type"] != "tv":
        raise APIError(422, "invalid_title", "Episode tracking is only available for TV shows.")
    return entry


def season_numbers(tmdb_id: int, season: int) -> list[int]:
    try:
        data = tmdb_get(f"/tv/{tmdb_id}/season/{season}")
    except APIError as exc:
        if exc.status_code == 404:
            raise APIError(422, "invalid_season", "This season could not be found.") from exc
        raise
    episodes = data.get("episodes")
    if not isinstance(episodes, list):
        raise APIError(502, "catalog_upstream_error", "Episode information could not be verified.")
    if data.get("season_number", season) != season or any(not isinstance(item, dict) for item in episodes):
        raise APIError(502, "catalog_upstream_error", "Episode information could not be verified.")
    numbers = [item.get("episode_number") for item in episodes]
    if any(type(number) is not int or number <= 0 or number > 2147483647 for number in numbers):
        raise APIError(502, "catalog_upstream_error", "Episode information could not be verified.")
    return sorted(set(numbers))


@router.get("/{entry_id}/episodes")
def list_episodes(entry_id: UUID, user: AuthenticatedUser = Depends(current_user),
                  store: PostgresLibraryStore = Depends(library_store)):
    tv_entry(store, user.id, entry_id)
    rows = store.episodes(user.id, entry_id)
    items = [{"season_number": row["season_number"], "episode_number": row["episode_number"]} for row in rows]
    return {"items": sorted(items, key=lambda item: (item["season_number"], item["episode_number"])), "last_watched": items[0] if items else None}


@router.put("/{entry_id}/seasons/{season}/episodes/{episode}", status_code=204)
def mark_episode(entry_id: UUID, season: int, episode: int, user: AuthenticatedUser = Depends(current_user),
                 store: PostgresLibraryStore = Depends(library_store)):
    if season < 0 or season > 2147483647 or episode <= 0 or episode > 2147483647:
        raise APIError(422, "invalid_episode", "Invalid season or episode number.")
    entry = tv_entry(store, user.id, entry_id)
    if episode not in season_numbers(entry["tmdb_id"], season):
        raise APIError(422, "invalid_episode", "This episode could not be found.")
    store.mark_episodes(user.id, entry_id, season, [episode])
    return Response(status_code=204)


@router.delete("/{entry_id}/seasons/{season}/episodes/{episode}", status_code=204)
def unmark_episode(entry_id: UUID, season: int, episode: int, user: AuthenticatedUser = Depends(current_user),
                   store: PostgresLibraryStore = Depends(library_store)):
    if season < 0 or season > 2147483647 or episode <= 0 or episode > 2147483647:
        raise APIError(422, "invalid_episode", "Invalid season or episode number.")
    tv_entry(store, user.id, entry_id)
    store.unmark_episodes(user.id, entry_id, season, [episode])
    return Response(status_code=204)


@router.put("/{entry_id}/seasons/{season}/episodes", status_code=204)
def mark_season(entry_id: UUID, season: int, user: AuthenticatedUser = Depends(current_user),
                store: PostgresLibraryStore = Depends(library_store)):
    if season < 0 or season > 2147483647:
        raise APIError(422, "invalid_season", "Invalid season number.")
    entry = tv_entry(store, user.id, entry_id)
    numbers = season_numbers(entry["tmdb_id"], season)
    if not numbers:
        raise APIError(422, "empty_season", "No episode information is available for this season.")
    store.mark_episodes(user.id, entry_id, season, numbers, bulk=True)
    return Response(status_code=204)


@router.delete("/{entry_id}/seasons/{season}/episodes", status_code=204)
def unmark_season(entry_id: UUID, season: int, user: AuthenticatedUser = Depends(current_user),
                  store: PostgresLibraryStore = Depends(library_store)):
    if season < 0 or season > 2147483647:
        raise APIError(422, "invalid_season", "Invalid season number.")
    tv_entry(store, user.id, entry_id)
    store.unmark_episodes(user.id, entry_id, season)
    return Response(status_code=204)


@router.get("")
def list_titles(media_type: MediaType | None = Query(default=None), status: Status | None = Query(default=None),
                limit: int = Query(default=20, ge=1, le=50), offset: int = Query(default=0, ge=0),
                user: AuthenticatedUser = Depends(current_user), store: PostgresLibraryStore = Depends(library_store)):
    rows = store.list(user.id, media_type, status, limit + 1, offset)
    return {"items": rows[:limit], "next_offset": offset + limit if len(rows) > limit else None}


@router.post("", status_code=201)
def create_title(body: CreateTitle, user: AuthenticatedUser = Depends(current_user),
                 store: PostgresLibraryStore = Depends(library_store)):
    validate_status(body.media_type, body.status)
    try:
        title = tmdb_get(f"/{body.media_type}/{body.tmdb_id}")
    except APIError as exc:
        if exc.status_code == 404:
            raise APIError(404, "title_not_found", "This title does not exist for the selected media type.") from exc
        raise
    if title.get("id") != body.tmdb_id:
        raise APIError(502, "catalog_upstream_error", "The title could not be verified. Try again.")
    return store.create(user.id, body.media_type, body.tmdb_id, body.status)


@router.patch("/{entry_id}")
def update_title(entry_id: UUID, body: UpdateTitle, user: AuthenticatedUser = Depends(current_user),
                 store: PostgresLibraryStore = Depends(library_store)):
    entry = store.get(user.id, entry_id)
    if entry is None:
        raise APIError(404, "title_not_found", "Saved title not found.")
    validate_status(entry["media_type"], body.status)
    updated = store.update(user.id, entry_id, body.status)
    if updated is None:
        raise APIError(404, "title_not_found", "Saved title not found.")
    return updated


@router.delete("/{entry_id}", status_code=204)
def delete_title(entry_id: UUID, user: AuthenticatedUser = Depends(current_user),
                 store: PostgresLibraryStore = Depends(library_store)):
    if store.delete(user.id, entry_id) is None:
        raise APIError(404, "title_not_found", "Saved title not found.")
    return Response(status_code=204)
