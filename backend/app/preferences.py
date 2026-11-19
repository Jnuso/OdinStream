"""Account preferences. Queries are scoped to the verified user id."""

import logging
from typing import Protocol

import psycopg

from app.db import user_connection
from app.errors import APIError

logger = logging.getLogger(__name__)

FAVORITE_GENRES = (
    "Action",
    "Animation",
    "Comedy",
    "Documentary",
    "Drama",
    "Fantasy",
    "Horror",
    "Romance",
    "Science Fiction",
    "Thriller",
)
STREAMING_SERVICES = (
    "Netflix",
    "Max",
    "Apple TV+",
    "Hulu",
    "Disney+",
)


class PreferenceStore(Protocol):
    def get(self, user_id: str) -> dict[str, list[str]]: ...

    def save(
        self,
        user_id: str,
        favorite_genres: list[str],
        streaming_services: list[str],
    ) -> dict[str, list[str]]: ...


class MemoryPreferenceStore:
    def __init__(self) -> None:
        self.rows: dict[str, dict[str, list[str]]] = {}

    def get(self, user_id: str) -> dict[str, list[str]]:
        row = self.rows.get(user_id)
        if row is None:
            return {"favorite_genres": [], "streaming_services": []}
        return {
            "favorite_genres": list(row["favorite_genres"]),
            "streaming_services": list(row["streaming_services"]),
        }

    def save(
        self,
        user_id: str,
        favorite_genres: list[str],
        streaming_services: list[str],
    ) -> dict[str, list[str]]:
        saved = {
            "favorite_genres": list(favorite_genres),
            "streaming_services": list(streaming_services),
        }
        self.rows[user_id] = saved
        return {
            "favorite_genres": list(favorite_genres),
            "streaming_services": list(streaming_services),
        }


class PostgresPreferenceStore:
    def __init__(self, database_url: str) -> None:
        self.database_url = database_url

    def get(self, user_id: str) -> dict[str, list[str]]:
        query = """
            select favorite_genres, streaming_services
            from public.user_preferences
            where user_id = %s
        """
        row = self._run(user_id, query, (user_id,))
        if row is None:
            return {"favorite_genres": [], "streaming_services": []}
        return {
            "favorite_genres": list(row[0]),
            "streaming_services": list(row[1]),
        }

    def save(
        self,
        user_id: str,
        favorite_genres: list[str],
        streaming_services: list[str],
    ) -> dict[str, list[str]]:
        query = """
            insert into public.user_preferences (user_id, favorite_genres, streaming_services)
            values (%s, %s, %s)
            on conflict (user_id) do update
            set favorite_genres = excluded.favorite_genres,
                streaming_services = excluded.streaming_services
            returning favorite_genres, streaming_services
        """
        row = self._run(user_id, query, (user_id, favorite_genres, streaming_services))
        if row is None:
            raise APIError(
                503,
                "preferences_unavailable",
                "Preferences could not be saved. Try again.",
            )
        return {
            "favorite_genres": list(row[0]),
            "streaming_services": list(row[1]),
        }

    def _run(self, user_id: str, query: str, params: tuple) -> tuple | None:
        try:
            with user_connection(self.database_url, user_id) as conn:
                cursor = conn.execute(query, params)
                return cursor.fetchone()
        except psycopg.Error as exc:
            logger.exception("Preferences database query failed")
            raise APIError(
                503,
                "preferences_unavailable",
                "Preferences are unavailable right now. Try again.",
            ) from exc


def normalize_choices(values: object, allowed: tuple[str, ...], label: str) -> list[str]:
    if not isinstance(values, list):
        raise APIError(422, "invalid_preferences", f"{label} must be a list.")
    chosen: list[str] = []
    for value in values:
        if not isinstance(value, str) or value not in allowed:
            raise APIError(422, "invalid_preferences", f"{value!s} is not a valid {label[:-1].lower()}.")
        if value not in chosen:
            chosen.append(value)
    return chosen
