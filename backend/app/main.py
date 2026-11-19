"""API entry point for the Odin Stream backend."""

from contextlib import asynccontextmanager
import logging
import os

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.account_deletion import router as account_deletion_router
from app.accounts import router as accounts_router
from app.catalog import (
    close_tmdb_client,
    filtered_router as filtered_catalog_router,
    router as catalog_router,
)
from app.db import close_pools, get_pool
from app.errors import APIError
from app.library import router as library_router
from app.recommendations import router as recommendations_router
from app.security_middleware import (
    MaxBodySizeMiddleware,
    RateLimitMiddleware,
    RequestLoggingMiddleware,
    SecurityHeadersMiddleware,
)
from app.settings import get_settings
from app.social import router as social_router
from app.tmdb_resilience import check_database_ready, shutdown_catalog_executor

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    yield
    shutdown_catalog_executor()
    close_tmdb_client()
    close_pools()


app = FastAPI(title="Odin Stream API", lifespan=lifespan)
settings = get_settings()

# Starlette applies middlewares in reverse registration order (last added = outermost).
# Keeping CORSMiddleware outermost ensures 413/429 responses still include CORS headers.
_rate_limit_enabled = os.environ.get("RATE_LIMIT_ENABLED", "true").strip().lower() not in (
    "0",
    "false",
    "no",
    "off",
)
app.add_middleware(RateLimitMiddleware, enabled=_rate_limit_enabled)
app.add_middleware(MaxBodySizeMiddleware, max_bytes=64 * 1024)
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(RequestLoggingMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.cors_origins),
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

app.include_router(accounts_router)
app.include_router(account_deletion_router)
app.include_router(catalog_router)
app.include_router(filtered_catalog_router)
app.include_router(library_router)
app.include_router(social_router)
app.include_router(recommendations_router)


@app.middleware("http")
async def private_account_responses(request, call_next):
    response = await call_next(request)
    raw_path = request.scope.get("path", "")
    if (
        raw_path == "/api/me"
        or raw_path.startswith("/api/me/")
        or request.headers.get("authorization")
    ):
        response.headers["Cache-Control"] = "private, no-store"
    return response


@app.exception_handler(StarletteHTTPException)
def handle_http_error(_request, exc: StarletteHTTPException) -> JSONResponse:
    message = exc.detail if isinstance(exc.detail, str) else "The request could not be completed."
    return JSONResponse(
        status_code=exc.status_code,
        headers=exc.headers,
        content={"error": "http_error", "message": message},
    )


@app.exception_handler(RequestValidationError)
def handle_validation_error(_request, exc: RequestValidationError) -> JSONResponse:
    details = [
        {
            "field": ".".join(str(part) for part in error["loc"] if part != "body"),
            "message": error["msg"],
        }
        for error in exc.errors()
    ]
    return JSONResponse(
        status_code=422,
        content={
            "error": "validation_error",
            "message": "Check the submitted information.",
            "details": details,
        },
    )


@app.exception_handler(APIError)
def handle_api_error(_request, exc: APIError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": exc.error, "message": exc.message},
    )


@app.exception_handler(Exception)
def handle_unexpected_error(_request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled application error", exc_info=exc)
    return JSONResponse(
        status_code=500,
        content={"error": "internal_error", "message": "An unexpected error occurred."},
    )


@app.get("/health")
def health() -> dict[str, str]:
    """Report that the API process can respond to requests."""
    return {"status": "ok"}


@app.get("/ready")
def ready() -> JSONResponse:
    """Verify PostgreSQL pool connectivity for post-deploy readiness checks."""
    current = get_settings()
    if not current.database_url:
        return JSONResponse(status_code=503, content={"status": "not_configured"})
    ok, status = check_database_ready(lambda: get_pool(current.database_url))
    if not ok:
        return JSONResponse(status_code=503, content={"status": status})
    return JSONResponse(status_code=200, content={"status": "ok"})
