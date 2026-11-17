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

The initial setup does not connect to Supabase, authenticate users, or serve application data. The team still needs to agree on authentication and database configuration before adding those integrations. Never commit credentials or `.env` files.

## Run the health test

From `backend`, install the test dependencies and run the suite:

```powershell
.\.venv\Scripts\python -m pip install -r requirements-test.txt
.\.venv\Scripts\python -m unittest discover -s tests -v
```

GitHub Actions runs the same test on pushes, pull requests, and manual runs. It checks the HTTP response in the test client, not database connectivity or a deployed server.
