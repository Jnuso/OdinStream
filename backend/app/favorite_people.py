"""Private TMDB person favorites."""

import logging
from typing import Annotated

import psycopg
from fastapi import APIRouter, Depends, Path
from psycopg.rows import dict_row

from app.accounts import current_user
from app.auth import AuthenticatedUser
from app.catalog import person_details
from app.db import user_connection
from app.errors import APIError
from app.settings import Settings, get_settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/me/favorite-people", tags=["favorite people"])
PersonId = Annotated[int, Path(gt=0, le=2147483647)]
User = Annotated[AuthenticatedUser, Depends(current_user)]
Config = Annotated[Settings, Depends(get_settings)]


def query(settings: Settings, user: User, sql: str, values: tuple = ()) -> list[dict]:
    if not settings.database_url:
        raise APIError(503, "favorites_unavailable", "Favorites are unavailable right now.")
    try:
        with user_connection(settings.database_url, user.id, row_factory=dict_row) as conn:
            cursor = conn.execute(sql, (user.id, *values))
            return cursor.fetchall() if cursor.description else []
    except psycopg.Error as exc:
        logger.exception("Favorite people query failed")
        raise APIError(503, "favorites_unavailable", "Favorites are unavailable right now.") from exc


@router.get("")
def list_people(user: User, settings: Config) -> dict:
    return {"items": query(settings, user, """
        select tmdb_person_id as id, name, profile_path from public.favorite_people
        where user_id = %s order by created_at desc, tmdb_person_id desc
    """)}


@router.get("/{person_id}")
def favorite_status(person_id: PersonId, user: User, settings: Config) -> dict:
    rows = query(settings, user, """
        select 1 from public.favorite_people where user_id = %s and tmdb_person_id = %s
    """, (person_id,))
    return {"favorited": bool(rows)}


@router.put("/{person_id}")
def save_person(person_id: PersonId, user: User, settings: Config) -> dict:
    if not favorite_status(person_id, user, settings)["favorited"]:
        person = person_details(person_id)
        query(settings, user, """
            insert into public.favorite_people (user_id, tmdb_person_id, name, profile_path)
            values (%s, %s, %s, %s) on conflict (user_id, tmdb_person_id) do nothing
        """, (person_id, person["name"], person["profile_path"]))
    return {"favorited": True}


@router.delete("/{person_id}", status_code=204)
def remove_person(person_id: PersonId, user: User, settings: Config) -> None:
    query(settings, user, """
        delete from public.favorite_people where user_id = %s and tmdb_person_id = %s
    """, (person_id,))
