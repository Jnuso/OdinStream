"""Public profiles, ratings and reviews, and follow relationships."""

from __future__ import annotations

import re
from typing import Literal
from uuid import UUID

import psycopg
from fastapi import APIRouter, Depends, Query, Response
from psycopg.rows import dict_row
from pydantic import BaseModel, ConfigDict, Field, StrictInt

from app.accounts import current_user
from app.auth import AuthenticatedUser
from app.catalog import tmdb_get
from app.errors import APIError
from app.settings import Settings, get_settings

router = APIRouter(prefix="/api", tags=["social"])
MediaType = Literal["movie", "tv"]
HANDLE = re.compile(r"^[a-z0-9_.]{3,30}$")
POST_COLUMNS = """post.id, post.media_type, post.tmdb_id, post.title_name, post.poster_path,
    post.release_date, post.rating, post.review, post.created_at, post.updated_at,
    author.user_id as author_id, author.display_name as author_name, author.handle as author_handle"""
PROFILE_COLUMNS = """profile.user_id, profile.display_name, profile.handle, profile.bio,
    profile.created_at, profile.updated_at,
    (select count(*) from public.posts p where p.user_id = profile.user_id)::int as post_count,
    (select count(*) from public.follows f where f.followee_id = profile.user_id)::int as follower_count,
    (select count(*) from public.follows f where f.follower_id = profile.user_id)::int as following_count,
    exists(select 1 from public.follows f
           where f.follower_id = %s and f.followee_id = profile.user_id) as viewer_follows"""


class PostInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    rating: StrictInt = Field(ge=1, le=5)
    review: str | None = Field(default=None, max_length=1000)


class ProfileInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    display_name: str = Field(min_length=1, max_length=60)
    handle: str = Field(min_length=3, max_length=30)
    bio: str = Field(default="", max_length=280)


def shape_post(row: dict) -> dict:
    return {
        "id": str(row["id"]),
        "media_type": row["media_type"],
        "tmdb_id": row["tmdb_id"],
        "title_name": row["title_name"],
        "poster_path": row["poster_path"],
        "release_date": row["release_date"],
        "rating": row["rating"],
        "review": row["review"],
        "created_at": row["created_at"].isoformat(),
        "updated_at": row["updated_at"].isoformat(),
        "author": {
            "id": str(row["author_id"]),
            "display_name": row["author_name"],
            "handle": row["author_handle"],
        },
    }


def shape_profile(row: dict) -> dict:
    return {
        "id": str(row["user_id"]),
        "display_name": row["display_name"],
        "handle": row["handle"],
        "bio": row["bio"],
        "post_count": row["post_count"],
        "follower_count": row["follower_count"],
        "following_count": row["following_count"],
        "viewer_follows": row["viewer_follows"],
    }


class PostgresSocialStore:
    def __init__(self, database_url: str) -> None:
        self.database_url = database_url

    def _run(self, user_id: str, query: str, params: tuple, *, many: bool = False,
             conflict: tuple[int, str, str] | None = None):
        try:
            with psycopg.connect(self.database_url, row_factory=dict_row) as conn:
                conn.execute("set local role odin_api")
                conn.execute("select set_config('app.user_id', %s, true)", (user_id,))
                cursor = conn.execute(query, params)
                return cursor.fetchall() if many else cursor.fetchone()
        except psycopg.errors.UniqueViolation as exc:
            status, error, message = conflict or (409, "duplicate_entry", "That entry already exists.")
            raise APIError(status, error, message) from exc
        except psycopg.Error as exc:
            raise APIError(503, "social_unavailable", "Ratings and reviews are unavailable right now. Try again.") from exc

    def feed(self, user_id: str, scope: str, limit: int, offset: int) -> list[dict]:
        rows = self._run(user_id, f"""
            select {POST_COLUMNS}
            from public.posts post
            join public.profiles author on author.user_id = post.user_id
            where %s = 'public' or post.user_id = %s
               or post.user_id in (select f.followee_id from public.follows f where f.follower_id = %s)
            order by post.created_at desc, post.id desc
            limit %s offset %s""", (scope, user_id, user_id, limit, offset), many=True)
        return [shape_post(row) for row in rows]

    def posts_for_title(self, user_id: str, media_type: str, tmdb_id: int, limit: int) -> list[dict]:
        rows = self._run(user_id, f"""
            select {POST_COLUMNS}
            from public.posts post
            join public.profiles author on author.user_id = post.user_id
            where post.media_type = %s and post.tmdb_id = %s
            order by post.created_at desc, post.id desc
            limit %s""", (media_type, tmdb_id, limit), many=True)
        return [shape_post(row) for row in rows]

    def posts_by_author(self, user_id: str, profile_id: str, limit: int, offset: int) -> list[dict]:
        rows = self._run(user_id, f"""
            select {POST_COLUMNS}
            from public.posts post
            join public.profiles author on author.user_id = post.user_id
            where post.user_id = %s
            order by post.created_at desc, post.id desc
            limit %s offset %s""", (profile_id, limit, offset), many=True)
        return [shape_post(row) for row in rows]

    def create(self, user_id: str, media_type: str, tmdb_id: int, title: dict,
               rating: int, review: str | None) -> dict:
        row = self._run(user_id, f"""
            with inserted as (
                insert into public.posts
                    (user_id, media_type, tmdb_id, title_name, poster_path, release_date, rating, review)
                values (%s, %s, %s, %s, %s, %s, %s, %s)
                returning *
            )
            select {POST_COLUMNS}
            from inserted post
            join public.profiles author on author.user_id = post.user_id""",
            (user_id, media_type, tmdb_id, title["name"], title["poster_path"], title["release_date"],
             rating, review),
            conflict=(409, "duplicate_post", "You already posted about this title. Edit that post instead."))
        if row is None:
            raise APIError(503, "social_unavailable", "Your post could not be saved. Try again.")
        return shape_post(row)

    def update(self, user_id: str, post_id: UUID, rating: int, review: str | None) -> dict:
        row = self._run(user_id, f"""
            with updated as (
                update public.posts
                set rating = %s, review = %s
                where id = %s and user_id = %s
                returning *
            )
            select {POST_COLUMNS}
            from updated post
            join public.profiles author on author.user_id = post.user_id""",
            (rating, review, post_id, user_id))
        if row is None:
            raise APIError(404, "post_not_found", "Post not found.")
        return shape_post(row)

    def delete(self, user_id: str, post_id: UUID) -> None:
        if self._run(user_id, "delete from public.posts where id = %s and user_id = %s returning id",
                     (post_id, user_id)) is None:
            raise APIError(404, "post_not_found", "Post not found.")

    def profile(self, viewer_id: str, profile_id: str) -> dict:
        row = self._run(viewer_id, f"select {PROFILE_COLUMNS} from public.profiles profile where profile.user_id = %s",
                        (viewer_id, profile_id))
        if row is None:
            raise APIError(404, "profile_not_found", "Profile not found.")
        return shape_profile(row)

    def profiles(self, viewer_id: str, limit: int) -> list[dict]:
        rows = self._run(viewer_id, f"""
            select {PROFILE_COLUMNS}
            from public.profiles profile
            where profile.user_id <> %s
            order by follower_count desc, profile.created_at asc
            limit %s""", (viewer_id, viewer_id, limit), many=True)
        return [shape_profile(row) for row in rows]

    def update_profile(self, user_id: str, display_name: str, handle: str, bio: str) -> dict:
        row = self._run(user_id, f"""
            with updated as (
                update public.profiles
                set display_name = %s, handle = %s, bio = %s
                where user_id = %s
                returning *
            )
            select {PROFILE_COLUMNS} from updated profile""",
            (display_name, handle, bio, user_id, user_id),
            conflict=(409, "duplicate_handle", "That handle is already taken."))
        if row is None:
            raise APIError(404, "profile_not_found", "Profile not found.")
        return shape_profile(row)

    def follow(self, user_id: str, profile_id: str) -> None:
        if self._run(user_id, "select 1 from public.profiles where user_id = %s", (profile_id,)) is None:
            raise APIError(404, "profile_not_found", "Profile not found.")
        self._run(user_id, """insert into public.follows (follower_id, followee_id)
            values (%s, %s) on conflict do nothing returning follower_id""", (user_id, profile_id))

    def unfollow(self, user_id: str, profile_id: str) -> None:
        self._run(user_id, """delete from public.follows where follower_id = %s and followee_id = %s
            returning follower_id""", (user_id, profile_id))

    def following_ids(self, user_id: str) -> list[str]:
        rows = self._run(user_id, "select followee_id from public.follows where follower_id = %s",
                         (user_id,), many=True)
        return [str(row["followee_id"]) for row in rows]


def social_store(settings: Settings = Depends(get_settings)) -> PostgresSocialStore:
    if not settings.database_url:
        raise APIError(503, "social_unavailable", "Ratings and reviews are not configured.")
    return PostgresSocialStore(settings.database_url)


@router.get("/feed")
def read_feed(scope: Literal["public", "following"] = Query(default="public"),
              limit: int = Query(default=30, ge=1, le=50),
              offset: int = Query(default=0, ge=0, le=1000),
              user: AuthenticatedUser = Depends(current_user),
              store: PostgresSocialStore = Depends(social_store)) -> dict:
    return {"items": store.feed(user.id, scope, limit, offset)}


@router.get("/profiles")
def read_profiles(limit: int = Query(default=5, ge=1, le=20),
                  user: AuthenticatedUser = Depends(current_user),
                  store: PostgresSocialStore = Depends(social_store)) -> dict:
    return {"items": store.profiles(user.id, limit)}


@router.get("/profiles/{profile_id}")
def read_profile(profile_id: UUID, user: AuthenticatedUser = Depends(current_user),
                 store: PostgresSocialStore = Depends(social_store)) -> dict:
    return store.profile(user.id, str(profile_id))


@router.get("/profiles/{profile_id}/posts")
def read_profile_posts(profile_id: UUID, limit: int = Query(default=30, ge=1, le=50),
                       offset: int = Query(default=0, ge=0, le=1000),
                       user: AuthenticatedUser = Depends(current_user),
                       store: PostgresSocialStore = Depends(social_store)) -> dict:
    store.profile(user.id, str(profile_id))
    return {"items": store.posts_by_author(user.id, str(profile_id), limit, offset)}


@router.get("/me/profile")
def read_own_profile(user: AuthenticatedUser = Depends(current_user),
                     store: PostgresSocialStore = Depends(social_store)) -> dict:
    return store.profile(user.id, user.id)


@router.patch("/me/profile")
def update_own_profile(body: ProfileInput, user: AuthenticatedUser = Depends(current_user),
                       store: PostgresSocialStore = Depends(social_store)) -> dict:
    display_name = body.display_name.strip()
    handle = body.handle.strip().lower()
    if not display_name:
        raise APIError(422, "invalid_profile", "Enter a display name.")
    if not HANDLE.fullmatch(handle):
        raise APIError(422, "invalid_profile",
                       "Handles use 3-30 lowercase letters, numbers, dots or underscores.")
    return store.update_profile(user.id, display_name, handle, body.bio.strip())


@router.put("/profiles/{profile_id}/follow", status_code=204)
def follow_profile(profile_id: UUID, user: AuthenticatedUser = Depends(current_user),
                   store: PostgresSocialStore = Depends(social_store)) -> Response:
    if str(profile_id) == user.id:
        raise APIError(422, "cannot_follow_self", "You cannot follow your own account.")
    store.follow(user.id, str(profile_id))
    return Response(status_code=204)


@router.delete("/profiles/{profile_id}/follow", status_code=204)
def unfollow_profile(profile_id: UUID, user: AuthenticatedUser = Depends(current_user),
                     store: PostgresSocialStore = Depends(social_store)) -> Response:
    store.unfollow(user.id, str(profile_id))
    return Response(status_code=204)


@router.get("/titles/{media_type}/{tmdb_id}/posts")
def read_title_posts(media_type: MediaType, tmdb_id: int,
                     user: AuthenticatedUser = Depends(current_user),
                     store: PostgresSocialStore = Depends(social_store)) -> dict:
    if tmdb_id <= 0:
        raise APIError(422, "invalid_title", "Title IDs must be positive.")
    return {"items": store.posts_for_title(user.id, media_type, tmdb_id, 30)}


@router.post("/titles/{media_type}/{tmdb_id}/posts", status_code=201)
def create_post(media_type: MediaType, tmdb_id: int, body: PostInput,
                user: AuthenticatedUser = Depends(current_user),
                store: PostgresSocialStore = Depends(social_store)) -> dict:
    if tmdb_id <= 0:
        raise APIError(422, "invalid_title", "Title IDs must be positive.")
    try:
        title = tmdb_get(f"/{media_type}/{tmdb_id}")
    except APIError as exc:
        if exc.status_code == 404:
            raise APIError(422, "invalid_title", "This title does not exist for the selected media type.") from exc
        raise
    if title.get("id") != tmdb_id:
        raise APIError(502, "catalog_upstream_error", "The title could not be verified. Try again.")
    snapshot = {
        "name": title.get("title") if media_type == "movie" else title.get("name"),
        "poster_path": title.get("poster_path"),
        "release_date": title.get("release_date") if media_type == "movie" else title.get("first_air_date"),
    }
    if not snapshot["name"]:
        raise APIError(502, "catalog_upstream_error", "The title could not be read. Try again.")
    review = body.review.strip() if body.review else None
    return store.create(user.id, media_type, tmdb_id, snapshot, body.rating, review or None)


@router.patch("/posts/{post_id}")
def update_post(post_id: UUID, body: PostInput, user: AuthenticatedUser = Depends(current_user),
                store: PostgresSocialStore = Depends(social_store)) -> dict:
    review = body.review.strip() if body.review else None
    return store.update(user.id, post_id, body.rating, review or None)


@router.delete("/posts/{post_id}", status_code=204)
def delete_post(post_id: UUID, user: AuthenticatedUser = Depends(current_user),
                store: PostgresSocialStore = Depends(social_store)) -> Response:
    store.delete(user.id, post_id)
    return Response(status_code=204)
