# OdinStream deployment runbook

## Services

The repository deploys the FastAPI service with [render.yaml](../../render.yaml).
The frontend is built separately as a static Vite site. Keep the frontend origin
and API origin separate unless the hosting provider is explicitly configured to
serve both.

## Render API service

Create or verify the service from the repository blueprint:

- Service name: `odin-stream-api`
- Root directory: `backend`
- Build command: `pip install -r requirements.txt`
- Start command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT --proxy-headers`
- Health check: `/health`
- Runtime: Python 3.12

Enter these values directly in the Render dashboard as secrets or environment
variables; never commit them:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY`
- `DATABASE_URL` using the Supabase session pooler and the least-privilege
  `odin_api_login`
- `TMDB_READ_ACCESS_TOKEN`

Set `CORS_ORIGINS` to the exact HTTPS frontend origin(s), comma-separated. Do not
include a trailing slash or an untrusted preview origin.

## Frontend service

Build from `frontend` with:

```sh
npm ci
npm run build
```

Publish `frontend/dist` and set these build-time variables in the hosting
dashboard:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_API_BASE_URL` to the deployed API origin

Only the publishable Supabase key belongs in frontend configuration. Never expose
the database URL, secret key, service-role key, or TMDB token.

## Supabase Auth configuration

After the frontend has a stable HTTPS URL, set it as the Supabase **Site URL** and
add only the exact production and approved preview URLs under **Redirect URLs**.
Then verify the email flows in
[email-delivery.md](./email-delivery.md).

## Verification

Run the standard checks before deployment:

```sh
cd frontend && npm test && npm run build && npm run lint
cd ../backend && python -m unittest discover -s tests -v
```

After deployment, run the standard-library smoke test without printing secrets:

```sh
BASE_URL=https://<api-host> \
EXPECTED_ORIGIN=https://<frontend-host> \
CHECK_READY=1 \
CHECK_SECURITY_HEADERS=1 \
python3 tests/test_deploy_smoke.py
```

Confirm `/health`, `/ready`, CORS, security headers, public catalog access, and
authenticated access with a disposable account. Record only URLs, timestamps,
and pass/fail results in the handoff.
