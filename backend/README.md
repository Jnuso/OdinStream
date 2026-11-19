# Odin Stream backend

A FastAPI application for catalog, accounts, libraries, social features, and recommendations. The health endpoint checks that the API process is responding; it does not verify a database or external services.

## Local setup

From the `backend` directory, using Python 3.10 or newer:

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
.\.venv\Scripts\python -m uvicorn app.main:app --reload
```

Open http://127.0.0.1:8000/health to check the server or http://127.0.0.1:8000/docs for interactive API documentation. Stop the server with Ctrl+C.

The API includes public TMDB-backed catalog search, title details, U.S. watch providers and TV season details. Set `TMDB_READ_ACCESS_TOKEN` in the backend process environment before starting the server; the backend does not automatically load the project `.env` file. Never commit credentials or `.env` files. The account, preferences and saved-title endpoints require `SUPABASE_URL` and `DATABASE_URL`; HS256 tokens additionally require `SUPABASE_JWT_SECRET`. Configure a dedicated backend login that is a member of `odin_api`, not a database administrator. The API switches to this non-bypass role within each transaction and scopes queries to the verified user. Creating a saved title requires TMDB verification. See `supabase/README.md` for migration and role setup; the frontend uses these social endpoints when configured.

## Run the test suite

From `backend`, install the test dependencies and run the suite:

```powershell
.\.venv\Scripts\python -m pip install -r requirements-test.txt
.\.venv\Scripts\python -m unittest discover -s tests -v
```

GitHub Actions runs the same suite on pushes, pull requests, and manual runs. It checks the HTTP responses in the test client, not database connectivity or a deployed server.

## Production architecture and security hardening

- **Connection pooling (`backend/app/db.py`):** Database access uses a shared `psycopg-pool` `ConnectionPool` (`connect_timeout=5`) with transaction-local `set local role odin_api` and `set_config('app.user_id', ..., true)`.
- **Health and readiness:** `GET /health` is a fast liveness check (`200 {"status": "ok"}`); `GET /ready` verifies PostgreSQL pool connectivity via `SELECT 1` (`200` or `503`).
- **Defensive middleware (`backend/app/security_middleware.py`):**
  - Baseline HTTP security headers (`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`).
  - `Cache-Control: private, no-store` on `/api/me*` and any request carrying an `Authorization` header (using ASGI `scope["path"]` to prevent Host-header path divergence).
  - 64 KB max JSON payload limit (`413`) and per-IP sliding-window rate limiting (`429` + `Retry-After`; set `RATE_LIMIT_ENABLED=false` to disable in local load tests).
  - `X-Request-ID` correlation header and structured request logging (without logging `Authorization` headers or tokens).
- **Live post-deploy smoke test (`tests/test_deploy_smoke.py`):** Run right after Render deploys using only the Python standard library:
  ```bash
  BASE_URL=https://odin-stream-api.onrender.com EXPECTED_ORIGIN=https://<your-frontend>.onrender.com CHECK_READY=1 CHECK_SECURITY_HEADERS=1 python3 tests/test_deploy_smoke.py
  ```

## Profile privacy and follow requests

New profiles remain private until setup is complete. Use `PATCH /api/me/profile/visibility` with `{"visibility":"private"}` or `{"visibility":"public"}` to change it. `PUT /api/profiles/{user_id}/follow` follows a public profile or requests a private one; inspect `viewer_follows` and `viewer_requested` on the profile to distinguish them. `DELETE` on the same route cancels a request or unfollows. The profile owner can list `GET /api/me/follow-requests`, then POST to `/api/me/follow-requests/{requester_id}/approve` or `/decline`; `DELETE /api/me/followers/{user_id}` removes a follower. Existing followers remain when a profile becomes private. When a private profile becomes public, pending requests are automatically approved. Private posts are excluded from public feeds and are visible only to approved followers and the owner.

The frontend exposes profile privacy settings; follow-request management is not yet available. Account deletion is described below. Deployment still requires separate frontend configuration, a provisioned least-privilege database login, secrets, and hosted end-to-end checks. The broader API contract remains a proposal and differs from the implemented paths and response formats.

## Account deletion

`DELETE /api/me` requires a verified bearer token and JSON `{"password":"..."}`. The backend checks the password with Supabase, verifies that the returned user ID matches the session, and requests a hard deletion through Supabase Auth. Existing foreign keys cascade to the app-owned tables. Configure `SUPABASE_PUBLISHABLE_KEY` and the server-only `SUPABASE_SECRET_KEY` (or legacy service-role key); never expose the secret to the browser. Missing configuration, an incorrect password, an upstream failure, or an account without an email/password fails closed. The frontend still needs a clear confirmation and password form.

Supabase access tokens already issued before deletion can remain valid until expiration because this backend verifies JWTs locally. Database cascades remove the account-owned data, but the token may still access authenticated public endpoints until it expires. The endpoint also does not remove future external copies or Storage objects. Validate the deletion flow against a disposable hosted account and resolve those limits before production use. See [Supabase user management](https://supabase.com/docs/guides/auth/managing-user-data).

## First-time setup

After sign-up and email confirmation, `GET /api/me/setup` reports whether setup is complete. `PUT /api/me/setup` requires `username` and `visibility` (`public` or `private`) and accepts optional `favorite_genres` and `streaming_services` arrays. All choices are saved in one transaction. Usernames allow 3–30 ASCII letters, digits, dots or underscores; their capitalization is retained, and a database index enforces uniqueness ignoring case. Incomplete accounts start private, are hidden from other users, and cannot use authenticated application endpoints until setup is completed. Account deletion remains available. Existing profiles at the time of migration keep their existing privacy and are considered set up.

The backend checks setup status in PostgreSQL on each protected request; a database outage fails closed. Before deploying, test the complete email-confirmation and setup flow against a disposable account and verify the target database has applied all migrations.

## Search and streaming filter

Public `GET /api/catalog/search` searches all movies and shows. Signed-in `GET /api/me/catalog/search` filters the current search page against subscription availability for the user's selected US services. It returns an error when no services are selected or availability cannot be checked. Page numbers refer to unfiltered TMDB results; an empty filtered page may have matches on later pages. The filter depends on TMDB/JustWatch availability and provider mappings, which can be incomplete or change. It does not include rentals or purchases.
