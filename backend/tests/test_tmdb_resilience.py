"""Unit tests for app.tmdb_resilience (runs with stdlib unittest or pytest)."""

from __future__ import annotations

import time
import unittest
from dataclasses import dataclass

from app.tmdb_resilience import (
    EXCLUDED_KEYS_SQL,
    UpstreamCatalogError,
    check_database_ready,
    enrich_items_gracefully,
    load_settings,
    request_tmdb_with_retry,
    shutdown_catalog_executor,
)


@dataclass
class _FakeResponse:
    status_code: int
    headers: dict[str, str]
    payload: dict | None = None


class _FakeCursor:
    def __init__(self, row=(1,), should_fail: bool = False) -> None:
        self._row = row
        self._should_fail = should_fail

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def execute(self, sql: str) -> None:
        if self._should_fail:
            raise ConnectionError("db down")

    def fetchone(self):
        return self._row


class _FakeConn:
    def __init__(self, row=(1,), should_fail: bool = False) -> None:
        self._row = row
        self._should_fail = should_fail

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def cursor(self):
        return _FakeCursor(self._row, self._should_fail)


class _FakePool:
    def __init__(self, row=(1,), should_fail: bool = False) -> None:
        self._row = row
        self._should_fail = should_fail

    def connection(self):
        return _FakeConn(self._row, self._should_fail)


class TestLoadSettings(unittest.TestCase):
    def test_loads_all_required_vars(self) -> None:
        env = {
            "SUPABASE_URL": "https://proj.supabase.co/",
            "DATABASE_URL": "postgresql://odin_api_login:pw@host:5432/postgres?sslmode=require",
            "TMDB_READ_ACCESS_TOKEN": "tmdb-token",
            "SUPABASE_PUBLISHABLE_KEY": "sb-pub",
            "SUPABASE_SECRET_KEY": "sb-sec",
            "CORS_ORIGINS": "https://a.onrender.com/, https://b.onrender.com",
        }
        s = load_settings(env)
        self.assertEqual(s.supabase_url, "https://proj.supabase.co")
        self.assertEqual(s.jwks_url, "https://proj.supabase.co/auth/v1/.well-known/jwks.json")
        self.assertEqual(s.cors_origins, ("https://a.onrender.com", "https://b.onrender.com"))
        self.assertTrue(s.rate_limit_enabled)

    def test_missing_var_raises_clear_error(self) -> None:
        with self.assertRaises(RuntimeError) as ctx:
            load_settings({"SUPABASE_URL": "https://proj.supabase.co"})
        self.assertIn("DATABASE_URL", str(ctx.exception))


class TestReadinessCheck(unittest.TestCase):
    def test_ready_when_select_1_succeeds(self) -> None:
        ok, status = check_database_ready(lambda: _FakePool(row=(1,)))
        self.assertTrue(ok)
        self.assertEqual(status, "ok")

    def test_not_ready_when_db_fails(self) -> None:
        ok, status = check_database_ready(lambda: _FakePool(should_fail=True))
        self.assertFalse(ok)
        self.assertEqual(status, "database_unavailable")


class TestGracefulEnrichment(unittest.TestCase):
    def tearDown(self) -> None:
        shutdown_catalog_executor(wait=True)

    def test_skips_404_and_slow_items_without_failing_page(self) -> None:
        def worker(item: int):
            if item == 2:
                raise LookupError("TMDB 404")
            if item == 3:
                time.sleep(0.3)
                return {"id": item}
            return {"id": item}

        out = enrich_items_gracefully([1, 2, 3, 4], worker, per_item_timeout=0.05)
        self.assertEqual(out, [{"id": 1}, {"id": 4}])


class TestTmdbRetry(unittest.TestCase):
    def test_retries_on_429_and_503_then_succeeds(self) -> None:
        responses = [
            _FakeResponse(429, {"Retry-After": "0.1"}),
            _FakeResponse(503, {}),
            _FakeResponse(200, {}, {"results": []}),
        ]
        sleeps: list[float] = []
        resp = request_tmdb_with_retry(
            lambda: responses.pop(0),
            max_attempts=3,
            base_delay=0.1,
            sleeper=sleeps.append,
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(sleeps), 2)

    def test_does_not_retry_on_404(self) -> None:
        calls = [0]

        def send():
            calls[0] += 1
            return _FakeResponse(404, {})

        resp = request_tmdb_with_retry(send, max_attempts=3, sleeper=lambda _: None)
        self.assertEqual(resp.status_code, 404)
        self.assertEqual(calls[0], 1)

    def test_exhausted_retries_raise_sanitized_upstream_error(self) -> None:
        with self.assertRaises(UpstreamCatalogError) as ctx:
            request_tmdb_with_retry(
                lambda: _FakeResponse(502, {}),
                max_attempts=2,
                sleeper=lambda _: None,
            )
        self.assertEqual(ctx.exception.status_code, 502)
        self.assertNotIn("token", ctx.exception.message.lower())

    def test_excluded_keys_sql_selects_only_key_columns(self) -> None:
        lower = EXCLUDED_KEYS_SQL.lower()
        self.assertIn("select media_type, tmdb_id", lower)
        self.assertNotIn("select *", lower)


if __name__ == "__main__":
    unittest.main()
