"""Password-confirmed deletion through Supabase Auth's server-only admin API."""
import json
import os
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, ConfigDict, Field, SecretStr

from app.accounts import current_user
from app.auth import AuthenticatedUser
from app.errors import APIError
from app.settings import Settings, get_settings

class NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


_opener = build_opener(NoRedirects())

router = APIRouter(prefix="/api/me", tags=["account"])


class DeleteAccountInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    password: SecretStr = Field(min_length=1, max_length=1024)


def delete_account_from_auth(user: AuthenticatedUser, password: str, settings: Settings) -> None:
    publishable = os.environ.get("SUPABASE_PUBLISHABLE_KEY", "").strip()
    secret = os.environ.get("SUPABASE_SECRET_KEY", "").strip()
    url = urlparse(settings.supabase_url)
    local = url.hostname in ("localhost", "127.0.0.1", "::1")
    if not publishable or not secret or not url.hostname or (url.scheme != "https" and not (url.scheme == "http" and local)):
        raise APIError(503, "account_deletion_unavailable", "Account deletion is not configured.")
    if not user.email:
        raise APIError(422, "password_confirmation_unavailable", "Password confirmation is unavailable for this account.")

    request = Request(f"{settings.issuer}/token?grant_type=password", method="POST",
        headers={"apikey": publishable, "Content-Type": "application/json"},
        data=json.dumps({"email": user.email, "password": password}).encode())
    try:
        with _opener.open(request, timeout=10) as response:
            auth_data = json.load(response)
    except HTTPError as exc:
        if exc.code in (400, 401, 403):
            raise APIError(401, "password_confirmation_failed", "Password confirmation failed.") from None
        if exc.code == 429:
            raise APIError(429, "password_confirmation_rate_limited", "Too many attempts. Try again later.") from None
        raise APIError(503, "account_deletion_unavailable", "Account deletion is temporarily unavailable.") from None
    except (URLError, TimeoutError, OSError, ValueError):
        raise APIError(503, "account_deletion_unavailable", "Account deletion is temporarily unavailable.") from None
    if not isinstance(auth_data, dict) or not isinstance(auth_data.get("user"), dict) or auth_data["user"].get("id") != user.id:
        raise APIError(401, "password_confirmation_failed", "Password confirmation failed.")

    # The admin API accepts the secret key in apikey; legacy JWT service-role keys
    # also use it as a bearer token. The target ID always comes from the session.
    headers = {"apikey": secret}
    if secret.startswith("eyJ"):
        headers["Authorization"] = f"Bearer {secret}"
    request = Request(f"{settings.issuer}/admin/users/{user.id}", method="DELETE", headers=headers)
    try:
        with _opener.open(request, timeout=10):
            pass
    except (HTTPError, URLError, TimeoutError, OSError):
        raise APIError(503, "account_deletion_unavailable", "The account could not be deleted. Try again.") from None


@router.delete("", status_code=204)
def delete_account(body: DeleteAccountInput, user: AuthenticatedUser = Depends(current_user),
                   settings: Settings = Depends(get_settings)) -> Response:
    delete_account_from_auth(user, body.password.get_secret_value(), settings)
    return Response(status_code=204)
