"""Account-owned movie and TV favorites, independent of library status."""

from typing import Annotated

from fastapi import APIRouter, Path
from psycopg import Connection

from app.catalog import MediaType, summarize, tmdb_get
from app.errors import APIError
from app.favorite_people import Config, User, favorite_connection, query

router = APIRouter(prefix="/api/me/favorite-titles", tags=["favorite titles"])
TitleId = Annotated[int, Path(gt=0, le=2147483647)]


def verify_title(media_type: MediaType, tmdb_id: int) -> dict:
    data = tmdb_get(f"/{media_type}/{tmdb_id}")
    title = summarize(data, media_type)
    if title["id"] != tmdb_id or not title["name"] or data.get("adult"):
        raise APIError(404, "title_not_found", "This title could not be found.")
    return {
        **title,
        "genre_ids": sorted({genre["id"] for genre in data.get("genres", [])
                             if isinstance(genre, dict) and type(genre.get("id")) is int}),
    }


def insert_title(conn: Connection, user_id: str, title: dict) -> None:
    conn.execute(
        """insert into public.favorite_titles (user_id, media_type, tmdb_id, name,
                                               release_date, poster_path, genre_ids)
           values (%s, %s, %s, %s, %s, %s, %s)
           on conflict (user_id, media_type, tmdb_id) do nothing""",
        (user_id, title["media_type"], title["id"], title["name"], title["release_date"],
         title["poster_path"], title["genre_ids"]),
    )


@router.get("")
def list_titles(user: User, settings: Config) -> dict:
    return {"items": query(settings, user, """
        select media_type, tmdb_id as id, name, release_date, poster_path
        from public.favorite_titles where user_id = %s
        order by created_at desc, media_type, tmdb_id
    """)}


@router.put("/{media_type}/{tmdb_id}")
def save_title(media_type: MediaType, tmdb_id: TitleId, user: User, settings: Config) -> dict:
    existing = query(settings, user, """
        select 1 from public.favorite_titles where user_id = %s and media_type = %s and tmdb_id = %s
    """, (media_type, tmdb_id))
    if not existing:
        title = verify_title(media_type, tmdb_id)
        with favorite_connection(settings, user) as conn:
            insert_title(conn, user.id, title)
    return {"favorited": True}


@router.delete("/{media_type}/{tmdb_id}", status_code=204)
def remove_title(media_type: MediaType, tmdb_id: TitleId, user: User, settings: Config) -> None:
    query(settings, user, """
        delete from public.favorite_titles where user_id = %s and media_type = %s and tmdb_id = %s
    """, (media_type, tmdb_id))
