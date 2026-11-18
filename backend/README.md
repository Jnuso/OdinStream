# Odin Stream backend

A minimal FastAPI application. The health endpoint checks that the API process is responding; it does not verify a database or external services.

## Local setup

From the `backend` directory, using Python 3.10 or newer:

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
.\.venv\Scripts\python -m uvicorn app.main:app --reload
```

Open http://127.0.0.1:8000/health to check the server or http://127.0.0.1:8000/docs for interactive API documentation. Stop the server with Ctrl+C.

The API includes public TMDB-backed catalog search, title details, U.S. watch providers and TV season details. Set `TMDB_READ_ACCESS_TOKEN` in the backend process environment before starting the server; the backend does not automatically load the project `.env` file. Never commit credentials or `.env` files. The account, preferences and saved-title endpoints require `SUPABASE_URL` and `DATABASE_URL`; HS256 tokens additionally require `SUPABASE_JWT_SECRET`. Configure a dedicated backend login that is a member of `odin_api`, not a database administrator. The API switches to this non-bypass role within each transaction and scopes queries to the verified user. Creating a saved title requires TMDB verification. See `supabase/README.md` for migration and role setup; the frontend's social screens remain a local prototype.

## Run the health test

From `backend`, install the test dependencies and run the suite:

```powershell
.\.venv\Scripts\python -m pip install -r requirements-test.txt
.\.venv\Scripts\python -m unittest discover -s tests -v
```

GitHub Actions runs the same test on pushes, pull requests, and manual runs. It checks the HTTP response in the test client, not database connectivity or a deployed server.
