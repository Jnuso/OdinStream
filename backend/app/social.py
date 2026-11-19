"""Public profiles, ratings and reviews, and follow relationships."""

from __future__ import annotations

import re
from typing import Literal
from uuid import UUID

import psycopg
from fastapi import APIRouter, Depends, Query, Response
from psycopg.rows import dict_row
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.accounts import current_user
from app.auth import AuthenticatedUser
from app.catalog import tmdb_get
from app.errors import APIError
from app.settings import Settings, get_settings

router = APIRouter(prefix="/api", tags=["social"])
MediaType = Literal["movie", "tv"]
HANDLE = re.compile(r"^[A-Za-z0-9_.]{3,30}$")
POST_COLUMNS = """post.id, post.media_type, post.tmdb_id, post.title_name, post.poster_path,
    post.release_date, post.rating, post.review, post.created_at, post.updated_at,
    author.user_id as author_id, author.display_name as author_name, author.handle as author_handle"""
PROFILE_COLUMNS = """profile.user_id, profile.display_name, profile.handle,
    case when profile.visibility = 'private' and profile.user_id <> nullif(current_setting('app.user_id', true), '')::uuid
      and not exists(select 1 from public.follows f where f.follower_id = nullif(current_setting('app.user_id', true), '')::uuid and f.followee_id = profile.user_id and f.status = 'following')
      then '' else profile.bio end as bio, profile.visibility,
    profile.created_at, profile.updated_at,
    (profile.visibility = 'public' or profile.user_id = nullif(current_setting('app.user_id', true), '')::uuid
     or exists(select 1 from public.follows f where f.follower_id = nullif(current_setting('app.user_id', true), '')::uuid and f.followee_id = profile.user_id and f.status = 'following')) as can_view_posts,
    (select count(*) from public.posts p where p.user_id = profile.user_id)::int as post_count,
    (select count(*) from public.follows f where f.followee_id = profile.user_id and f.status = 'following')::int as follower_count,
    (select count(*) from public.follows f where f.follower_id = profile.user_id and f.status = 'following')::int as following_count,
    exists(select 1 from public.follows f
           where f.follower_id = %s and f.followee_id = profile.user_id and f.status = 'following') as viewer_follows,
    exists(select 1 from public.follows f where f.follower_id = nullif(current_setting('app.user_id', true), '')::uuid and f.followee_id = profile.user_id and f.status = 'requested') as viewer_requested"""


class PostInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    rating: float = Field(ge=0.5, le=5, strict=True)
    review: str | None = Field(default=None, max_length=2000)

    @field_validator("rating")
    @classmethod
    def half_stars(cls, value: float) -> float:
        if value * 2 != int(value * 2):
            raise ValueError("Ratings must use half-star steps.")
        return value


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
        "post_count": row["post_count"] if row["can_view_posts"] else 0,
        "follower_count": row["follower_count"] if row["can_view_posts"] else 0,
        "following_count": row["following_count"] if row["can_view_posts"] else 0,
        "can_view_posts": row["can_view_posts"],
        "viewer_follows": row["viewer_follows"],
        "visibility": row["visibility"],
        "viewer_requested": row["viewer_requested"],
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
            where (%s = 'public' and author.visibility = 'public')
               or (%s = 'following' and (post.user_id = %s
                 or post.user_id in (select f.followee_id from public.follows f where f.follower_id = %s and f.status = 'following')))
            order by post.created_at desc, post.id desc
            limit %s offset %s""", (scope, scope, user_id, user_id, limit, offset), many=True)
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
        profile = self.profile(user_id, profile_id)
        status = "requested" if profile["visibility"] == "private" else "following"
        self._run(user_id, """insert into public.follows (follower_id, followee_id, status)
            values (%s, %s, %s) on conflict do nothing returning follower_id""", (user_id, profile_id, status))

    def unfollow(self, user_id: str, profile_id: str) -> None:
        self._run(user_id, "delete from public.follows where follower_id = %s and followee_id = %s returning follower_id",
                  (user_id, profile_id))

    def set_visibility(self, user_id: str, visibility: str) -> dict:
        self._run(user_id, "update public.profiles set visibility = %s where user_id = %s returning user_id",
                  (visibility, user_id))
        return self.profile(user_id, user_id)

    def requests(self, user_id: str, limit: int, offset: int) -> list[dict]:
        rows = self._run(user_id, """select f.follower_id, p.display_name, p.handle, f.created_at
            from public.follows f join public.profiles p on p.user_id = f.follower_id
            where f.followee_id = %s and f.status = 'requested' order by f.created_at, f.follower_id
            limit %s offset %s""",
            (user_id, limit, offset), many=True)
        return [{"user_id": str(r["follower_id"]), "display_name": r["display_name"],
                 "handle": r["handle"], "created_at": r["created_at"].isoformat()} for r in rows]

    def resolve_request(self, user_id: str, requester_id: str, approve: bool) -> None:
        if approve:
            row = self._run(user_id, """update public.follows set status = 'following'
                where follower_id = %s and followee_id = %s and status = 'requested' returning follower_id""",
                (requester_id, user_id))
        else:
            row = self._run(user_id, """delete from public.follows
                where follower_id = %s and followee_id = %s and status = 'requested' returning follower_id""",
                (requester_id, user_id))
        if row is None:
            raise APIError(404, "request_not_found", "Follow request not found.")

    def remove_follower(self, user_id: str, follower_id: str) -> None:
        self._run(user_id, "delete from public.follows where follower_id = %s and followee_id = %s returning follower_id",
                  (follower_id, user_id))



def social_store(settings: Settings = Depends(get_settings)) -> PostgresSocialStore:
    if not settings.database_url:
        raise APIError(503, "social_unavailable", "Ratings and reviews are not configured.")
    return PostgresSocialStore(settings.database_url)


@router.get("/feed")
def read_feed(scope: Literal["public", "following"] = Query(default="public"),
              limit: int = Query(default=30, ge=1, le=50),
              offset: int = Query(default=0, ge=0),
              user: AuthenticatedUser = Depends(current_user),
              store: PostgresSocialStore = Depends(social_store)) -> dict:
    rows = store.feed(user.id, scope, limit + 1, offset)
    return {"items": rows[:limit], "next_offset": offset + limit if len(rows) > limit else None}


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
                       offset: int = Query(default=0, ge=0),
                       user: AuthenticatedUser = Depends(current_user),
                       store: PostgresSocialStore = Depends(social_store)) -> dict:
    profile = store.profile(user.id, str(profile_id))
    if profile.get("visibility") == "private" and str(profile_id) != user.id and not profile["viewer_follows"]:
        raise APIError(403, "profile_private", "This profile is private.")
    rows = store.posts_by_author(user.id, str(profile_id), limit + 1, offset)
    return {"items": rows[:limit], "next_offset": offset + limit if len(rows) > limit else None}


@router.get("/me/profile")
def read_own_profile(user: AuthenticatedUser = Depends(current_user),
                     store: PostgresSocialStore = Depends(social_store)) -> dict:
    return store.profile(user.id, user.id)


@router.patch("/me/profile")
def update_own_profile(body: ProfileInput, user: AuthenticatedUser = Depends(current_user),
                       store: PostgresSocialStore = Depends(social_store)) -> dict:
    display_name = body.display_name.strip()
    handle = body.handle.strip()
    if not display_name:
        raise APIError(422, "invalid_profile", "Enter a display name.")
    if not HANDLE.fullmatch(handle):
        raise APIError(422, "invalid_profile",
                       "Usernames use 3-30 letters, numbers, dots or underscores.")
    return store.update_profile(user.id, display_name, handle, body.bio.strip())


class VisibilityInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    visibility: Literal["public", "private"]


@router.patch("/me/profile/visibility")
def change_visibility(body: VisibilityInput, user: AuthenticatedUser = Depends(current_user),
                      store: PostgresSocialStore = Depends(social_store)) -> dict:
    return store.set_visibility(user.id, body.visibility)


@router.get("/me/follow-requests")
def list_follow_requests(limit: int = Query(default=20, ge=1, le=50), offset: int = Query(default=0, ge=0),
                         user: AuthenticatedUser = Depends(current_user),
                         store: PostgresSocialStore = Depends(social_store)) -> dict:
    rows = store.requests(user.id, limit + 1, offset)
    return {"items": rows[:limit], "next_offset": offset + limit if len(rows) > limit else None}


@router.post("/me/follow-requests/{requester_id}/approve", status_code=204)
def approve_follow_request(requester_id: UUID, user: AuthenticatedUser = Depends(current_user),
                           store: PostgresSocialStore = Depends(social_store)) -> Response:
    store.resolve_request(user.id, str(requester_id), True)
    return Response(status_code=204)


@router.post("/me/follow-requests/{requester_id}/decline", status_code=204)
def decline_follow_request(requester_id: UUID, user: AuthenticatedUser = Depends(current_user),
                           store: PostgresSocialStore = Depends(social_store)) -> Response:
    store.resolve_request(user.id, str(requester_id), False)
    return Response(status_code=204)


@router.delete("/me/followers/{follower_id}", status_code=204)
def remove_follower(follower_id: UUID, user: AuthenticatedUser = Depends(current_user),
                    store: PostgresSocialStore = Depends(social_store)) -> Response:
    store.remove_follower(user.id, str(follower_id))
    return Response(status_code=204)


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
            raise APIError(404, "title_not_found", "This title does not exist for the selected media type.") from exc
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
