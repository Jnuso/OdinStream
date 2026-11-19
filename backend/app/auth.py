"""Verify Supabase access tokens. The user id always comes from the token."""

import logging
import uuid
from dataclasses import dataclass

import jwt
from jwt import PyJWKClient

from app.errors import APIError
from app.settings import Settings

logger = logging.getLogger(__name__)
_ALLOWED_ASYMMETRIC = ("ES256", "RS256")
_jwk_clients: dict[str, PyJWKClient] = {}


@dataclass(frozen=True)
class AuthenticatedUser:
    id: str
    email: str | None


def authenticate(authorization: str | None, settings: Settings) -> AuthenticatedUser:
    if authorization is None or not authorization.lower().startswith("bearer "):
        raise _unauthorized("Sign in to continue.")
    if not settings.issuer:
        raise _unauthorized("Sign in to continue.")
    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise _unauthorized("Sign in to continue.")
    try:
        header = jwt.get_unverified_header(token)
    except jwt.InvalidTokenError:
        raise _unauthorized("Sign in to continue.") from None
    algorithm = header.get("alg")
    try:
        if algorithm == "HS256":
            payload = _decode_shared_secret(token, settings)
        elif algorithm in _ALLOWED_ASYMMETRIC:
            payload = _decode_asymmetric(token, settings)
        else:
            raise _unauthorized("Sign in to continue.")
    except jwt.ExpiredSignatureError:
        raise _unauthorized("Your session has expired. Sign in again.") from None
    except jwt.PyJWKClientConnectionError:
        logger.warning("JWKS verification endpoint unavailable for %s", settings.jwks_url)
        raise APIError(503, "authentication_unavailable", "Sign-in verification is temporarily unavailable. Try again.") from None
    except (jwt.PyJWKClientError, jwt.PyJWKSetError, jwt.InvalidTokenError):
        raise _unauthorized("Sign in to continue.") from None
    if payload.get("role") != "authenticated":
        raise _unauthorized("Sign in to continue.")
    subject = payload.get("sub")
    if not isinstance(subject, str):
        raise _unauthorized("Sign in to continue.")
    try:
        user_id = str(uuid.UUID(subject))
    except ValueError:
        raise _unauthorized("Sign in to continue.") from None
    email = payload.get("email")
    return AuthenticatedUser(id=user_id, email=email if isinstance(email, str) else None)


def _decode_shared_secret(token: str, settings: Settings) -> dict:
    if not settings.jwt_secret:
        raise _unauthorized("Sign in to continue.")
    return jwt.decode(
        token,
        settings.jwt_secret,
        algorithms=["HS256"],
        audience="authenticated",
        issuer=settings.issuer,
        options={"require": ["exp", "sub", "aud", "iss"]},
    )


def _decode_asymmetric(token: str, settings: Settings) -> dict:
    if not settings.jwks_url:
        raise _unauthorized("Sign in to continue.")
    client = _jwk_clients.get(settings.jwks_url)
    if client is None:
        client = PyJWKClient(settings.jwks_url, timeout=5, lifespan=3600)
        _jwk_clients[settings.jwks_url] = client
    key = client.get_signing_key_from_jwt(token)
    return jwt.decode(
        token,
        key.key,
        algorithms=list(_ALLOWED_ASYMMETRIC),
        audience="authenticated",
        issuer=settings.issuer,
        options={"require": ["exp", "sub", "aud", "iss"]},
    )


def _unauthorized(message: str) -> APIError:
    return APIError(401, "authentication_required", message)
