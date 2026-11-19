"""Signed-in account identity and preferences."""

import logging
import re
from typing import Annotated, Any, Literal

import psycopg
from fastapi import APIRouter, Body, Depends, Header, Request
from pydantic import BaseModel, ConfigDict, Field

from app.auth import AuthenticatedUser, authenticate
from app.db import user_connection
from app.errors import APIError
from app.preferences import (
    FAVORITE_GENRES,
    STREAMING_SERVICES,
    PostgresPreferenceStore,
    PreferenceStore,
    normalize_choices,
)
from app.settings import Settings, get_settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/me", tags=["account"])


def current_user(
    request: Request,
    authorization: Annotated[str | None, Header()] = None,
    settings: Settings = Depends(get_settings),
) -> AuthenticatedUser:
    user = authenticate(authorization, settings)
    # Use raw ASGI scope path (not request.url.path) to prevent Host-header path divergence (CVE-2026-48710).
    raw_path = request.scope.get("path", "")
    # Setup and account deletion remain available to accounts that have not finished setup.
    exempt = raw_path == "/api/me/setup" or (raw_path == "/api/me" and request.method == "DELETE")
    if settings.database_url and not exempt and not setup_complete(user.id, settings.database_url):
        raise APIError(403, "setup_required", "Complete account setup to continue.")
    return user


def setup_complete(user_id: str, database_url: str) -> bool:
    try:
        with user_connection(database_url, user_id) as conn:
            row = conn.execute("select setup_complete from public.profiles where user_id = %s", (user_id,)).fetchone()
            return bool(row and row[0])
    except psycopg.Error as exc:
        logger.exception("Failed checking setup_complete for user")
        raise APIError(503, "account_unavailable", "Account setup is temporarily unavailable.") from exc


def preference_store(settings: Settings = Depends(get_settings)) -> PreferenceStore:
    if not settings.database_url:
        raise APIError(
            503,
            "preferences_unavailable",
            "Account preferences are not configured.",
        )
    return PostgresPreferenceStore(settings.database_url)


@router.get("")
def read_me(user: AuthenticatedUser = Depends(current_user)) -> dict[str, str | None]:
    return {"id": user.id, "email": user.email}


@router.get("/preferences")
def read_preferences(
    user: AuthenticatedUser = Depends(current_user),
    store: PreferenceStore = Depends(preference_store),
) -> dict[str, list[str]]:
    return store.get(user.id)


@router.put("/preferences")
def update_preferences(
    body: Annotated[dict[str, Any], Body()],
    user: AuthenticatedUser = Depends(current_user),
    store: PreferenceStore = Depends(preference_store),
) -> dict[str, list[str]]:
    if not isinstance(body, dict):
        raise APIError(422, "invalid_preferences", "Preferences must be an object.")
    genres = normalize_choices(body.get("favorite_genres"), FAVORITE_GENRES, "Favorite genres")
    services = normalize_choices(
        body.get("streaming_services"),
        STREAMING_SERVICES,
        "Streaming services",
    )
    return store.save(user.id, genres, services)


class SetupInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    username: str = Field(min_length=3, max_length=30)
    visibility: Literal["public", "private"]
    favorite_genres: list[str] = Field(default_factory=list)
    streaming_services: list[str] = Field(default_factory=list)


@router.get("/setup")
def get_setup(user: AuthenticatedUser = Depends(current_user), settings: Settings = Depends(get_settings)) -> dict:
    if not settings.database_url:
        raise APIError(503, "account_unavailable", "Account setup is not configured.")
    return {"setup_complete": setup_complete(user.id, settings.database_url)}


@router.put("/setup")
def complete_setup(
    body: SetupInput,
    user: AuthenticatedUser = Depends(current_user),
    settings: Settings = Depends(get_settings),
) -> dict:
    username = body.username.strip()
    if not re.fullmatch(r"[A-Za-z0-9_.]{3,30}", username):
        raise APIError(422, "invalid_username", "Usernames use 3-30 letters, numbers, dots or underscores.")
    genres = normalize_choices(body.favorite_genres, FAVORITE_GENRES, "Favorite genres")
    services = normalize_choices(body.streaming_services, STREAMING_SERVICES, "Streaming services")
    if not settings.database_url:
        raise APIError(503, "account_unavailable", "Account setup is not configured.")
    try:
        with user_connection(settings.database_url, user.id) as conn:
            row = conn.execute(
                """update public.profiles
                set handle = %s, display_name = %s, visibility = %s, setup_complete = true
                where user_id = %s and not setup_complete returning user_id""",
                (username, username, body.visibility, user.id),
            ).fetchone()
            if row is None:
                raise APIError(409, "setup_already_complete", "Account setup is already complete.")
            conn.execute(
                """insert into public.user_preferences (user_id, favorite_genres, streaming_services)
                values (%s, %s, %s) on conflict (user_id) do update
                set favorite_genres = excluded.favorite_genres, streaming_services = excluded.streaming_services""",
                (user.id, genres, services),
            )
    except psycopg.errors.UniqueViolation as exc:
        raise APIError(409, "duplicate_handle", "That username is already taken.") from exc
    except psycopg.Error as exc:
        logger.exception("Failed completing account setup")
        raise APIError(503, "account_unavailable", "Account setup is temporarily unavailable.") from exc
    return {"setup_complete": True, "username": username, "visibility": body.visibility}
