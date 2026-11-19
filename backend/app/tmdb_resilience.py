"""Backend resilience, centralized Settings validation, DB readiness check, and TMDB retry/executor helpers.

Designed as drop-in helpers for OdinStream's ``backend/app/settings.py``,
``backend/app/catalog.py``, ``backend/app/recommendations.py``, and ``backend/app/main.py``.
"""

from __future__ import annotations

import logging
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
from dataclasses import dataclass
from functools import lru_cache
from typing import Any, Callable, Iterable, TypeVar

logger = logging.getLogger("odinstream.resilience")

T = TypeVar("T")
R = TypeVar("R")

RETRYABLE_TMDB_STATUSES = frozenset({429, 500, 502, 503, 504})


@dataclass(frozen=True)
class AppSettings:
    supabase_url: str
    database_url: str
    tmdb_read_access_token: str
    supabase_publishable_key: str
    supabase_secret_key: str
    cors_origins: tuple[str, ...]
    rate_limit_enabled: bool = True
    max_body_bytes: int = 64 * 1024

    @property
    def jwks_url(self) -> str:
        return f"{self.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"


def load_settings(env: dict[str, str] | None = None) -> AppSettings:
    """Load and validate all required runtime env vars in one place."""
    source = os.environ if env is None else env

    def _req(name: str) -> str:
        val = (source.get(name) or "").strip()
        if not val:
            raise RuntimeError(f"Missing required environment variable: {name}")
        return val

    raw_origins = source.get("CORS_ORIGINS", "")
    origins = tuple(o.strip().rstrip("/") for o in raw_origins.split(",") if o.strip())

    rate_limit_raw = source.get("RATE_LIMIT_ENABLED", "true").strip().lower()
    rate_limit_enabled = rate_limit_raw not in ("0", "false", "no", "off")

    max_body_raw = source.get("MAX_BODY_BYTES", str(64 * 1024)).strip()
    try:
        max_body_bytes = max(1024, int(max_body_raw))
    except ValueError as exc:
        raise RuntimeError(f"Invalid MAX_BODY_BYTES value: {max_body_raw!r}") from exc

    return AppSettings(
        supabase_url=_req("SUPABASE_URL").rstrip("/"),
        database_url=_req("DATABASE_URL"),
        tmdb_read_access_token=_req("TMDB_READ_ACCESS_TOKEN"),
        supabase_publishable_key=_req("SUPABASE_PUBLISHABLE_KEY"),
        supabase_secret_key=_req("SUPABASE_SECRET_KEY"),
        cors_origins=origins,
        rate_limit_enabled=rate_limit_enabled,
        max_body_bytes=max_body_bytes,
    )


@lru_cache(maxsize=1)
def get_app_settings() -> AppSettings:
    return load_settings()


def check_database_ready(pool_getter: Callable[[], Any]) -> tuple[bool, str]:
    """Run a lightweight ``SELECT 1`` against the shared DB pool.

    Returns ``(is_ready, status_label)`` without leaking credentials or stack traces.
    """
    try:
        pool = pool_getter()
        with pool.connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
                row = cur.fetchone()
                if row and row[0] == 1:
                    return True, "ok"
        return False, "unexpected_result"
    except Exception:
        logger.exception("Readiness check failed: database unreachable")
        return False, "database_unavailable"


_executor_lock = threading.Lock()
_shared_executor: ThreadPoolExecutor | None = None


def get_catalog_executor(max_workers: int = 8) -> ThreadPoolExecutor:
    """Return a shared bounded ThreadPoolExecutor (avoids per-request thread leaks)."""
    global _shared_executor
    with _executor_lock:
        if _shared_executor is None:
            _shared_executor = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="tmdb-enrich")
        return _shared_executor


def shutdown_catalog_executor(*, wait: bool = True) -> None:
    """Call during FastAPI lifespan shutdown to cleanly stop worker threads."""
    global _shared_executor
    with _executor_lock:
        if _shared_executor is not None:
            _shared_executor.shutdown(wait=wait, cancel_futures=True)
            _shared_executor = None


def enrich_items_gracefully(
    items: Iterable[T],
    worker: Callable[[T], R | None],
    *,
    per_item_timeout: float = 5.0,
    max_workers: int = 8,
) -> list[R]:
    """Run ``worker`` across items using the shared executor, skipping per-item errors/timeouts."""
    item_list = list(items)
    if not item_list:
        return []

    executor = get_catalog_executor(max_workers=max_workers)
    futures = [executor.submit(worker, item) for item in item_list]
    results: list[R] = []
    for item, fut in zip(item_list, futures):
        try:
            value = fut.result(timeout=per_item_timeout)
            if value is not None:
                results.append(value)
        except FuturesTimeoutError:
            logger.warning("TMDB enrichment timed out for item=%r", item)
        except Exception as exc:
            logger.warning("TMDB enrichment skipped item=%r due to %s", item, type(exc).__name__)
    return results


class UpstreamCatalogError(RuntimeError):
    """Sanitized upstream error for mapping TMDB outages to HTTP 502/503 without leaking tokens."""

    def __init__(self, status_code: int, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.message = message


def request_tmdb_with_retry(
    send_fn: Callable[[], Any],
    *,
    max_attempts: int = 3,
    base_delay: float = 0.25,
    max_delay: float = 2.0,
    sleeper: Callable[[float], None] = time.sleep,
) -> Any:
    """Execute a TMDB HTTP call with bounded retry on transient 429/5xx responses."""
    last_status: int | None = None
    for attempt in range(1, max_attempts + 1):
        try:
            resp = send_fn()
        except Exception as exc:
            if attempt >= max_attempts:
                raise UpstreamCatalogError(503, "Catalog provider is temporarily unavailable.") from exc
            sleeper(min(max_delay, base_delay * (2 ** (attempt - 1))))
            continue

        status = int(getattr(resp, "status_code", 500))
        if status not in RETRYABLE_TMDB_STATUSES:
            return resp

        last_status = status
        if attempt >= max_attempts:
            break

        headers = getattr(resp, "headers", {}) or {}
        retry_after_raw = headers.get("Retry-After") or headers.get("retry-after")
        delay = min(max_delay, base_delay * (2 ** (attempt - 1)))
        if retry_after_raw:
            try:
                delay = min(max_delay, max(0.0, float(retry_after_raw)))
            except ValueError:
                pass
        sleeper(delay)

    mapped_status = 503 if last_status in (429, 503) else 502
    raise UpstreamCatalogError(mapped_status, "Catalog provider is temporarily unavailable.")


EXCLUDED_KEYS_SQL = """
SELECT media_type, tmdb_id
FROM public.library_items
WHERE user_id = current_setting('app.user_id', true)::uuid
"""
