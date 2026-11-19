"""Signed-in account identity and preferences."""

from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends, Header

from app.auth import AuthenticatedUser, authenticate
from app.errors import APIError
from app.preferences import (
    FAVORITE_GENRES,
    STREAMING_SERVICES,
    PostgresPreferenceStore,
    PreferenceStore,
    normalize_choices,
)
from app.settings import Settings, get_settings

router = APIRouter(prefix="/api/me", tags=["account"])


def current_user(
    authorization: Annotated[str | None, Header()] = None,
    settings: Settings = Depends(get_settings),
) -> AuthenticatedUser:
    return authenticate(authorization, settings)


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
