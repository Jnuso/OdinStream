"""Unit tests for app.security_middleware (runs with stdlib unittest or pytest)."""

from __future__ import annotations

import asyncio
import json
import logging
import unittest
from typing import Any

from app.security_middleware import (
    MaxBodySizeMiddleware,
    RateLimitMiddleware,
    RateLimitRule,
    RequestLoggingMiddleware,
    SecurityHeadersMiddleware,
    SlidingWindowRateLimiter,
    select_rate_limit_rule,
)


def _run_asgi(
    app: Any,
    *,
    method: str = "GET",
    path: str = "/api/catalog/search",
    headers: list[tuple[bytes, bytes]] | None = None,
    body: bytes = b"",
    client: tuple[str, int] = ("127.0.0.1", 12345),
) -> tuple[int, dict[str, str], bytes]:
    scope = {
        "type": "http",
        "method": method,
        "path": path,
        "headers": headers or [],
        "client": client,
    }
    sent_body = False

    async def receive() -> dict[str, Any]:
        nonlocal sent_body
        if not sent_body:
            sent_body = True
            return {"type": "http.request", "body": body, "more_body": False}
        return {"type": "http.request", "body": b"", "more_body": False}

    status = 0
    resp_headers: dict[str, str] = {}
    chunks: list[bytes] = []

    async def send(message: dict[str, Any]) -> None:
        nonlocal status
        if message["type"] == "http.response.start":
            status = message["status"]
            for k, v in message.get("headers", []):
                resp_headers[k.decode("latin-1").lower()] = v.decode("latin-1")
        elif message["type"] == "http.response.body":
            chunks.append(message.get("body", b""))

    asyncio.run(app(scope, receive, send))
    return status, resp_headers, b"".join(chunks)


async def _echo_app(scope: dict[str, Any], receive: Any, send: Any) -> None:
    body = b""
    while True:
        msg = await receive()
        body += msg.get("body", b"")
        if not msg.get("more_body", False):
            break
    payload = json.dumps({"ok": True, "size": len(body)}).encode("utf-8")
    await send(
        {
            "type": "http.response.start",
            "status": 200,
            "headers": [(b"content-type", b"application/json")],
        }
    )
    await send({"type": "http.response.body", "body": payload, "more_body": False})


class TestSecurityHeadersMiddleware(unittest.TestCase):
    def test_adds_default_security_headers(self) -> None:
        app = SecurityHeadersMiddleware(_echo_app)
        status, headers, _ = _run_asgi(app, path="/health")
        self.assertEqual(status, 200)
        self.assertEqual(headers.get("x-content-type-options"), "nosniff")
        self.assertEqual(headers.get("x-frame-options"), "DENY")
        self.assertEqual(headers.get("referrer-policy"), "strict-origin-when-cross-origin")
        self.assertIn("camera=()", headers.get("permissions-policy", ""))


class TestMaxBodySizeMiddleware(unittest.TestCase):
    def test_allows_small_payload(self) -> None:
        app = MaxBodySizeMiddleware(_echo_app, max_bytes=1024)
        status, _, raw = _run_asgi(
            app,
            method="POST",
            path="/api/posts",
            headers=[(b"content-length", b"16")],
            body=b'{"text":"hello"}',
        )
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(raw)["size"], 16)

    def test_rejects_oversized_content_length(self) -> None:
        app = MaxBodySizeMiddleware(_echo_app, max_bytes=1024)
        status, _, raw = _run_asgi(
            app,
            method="POST",
            path="/api/posts",
            headers=[(b"content-length", b"999999")],
            body=b"x",
        )
        self.assertEqual(status, 413)
        self.assertIn("too large", json.loads(raw)["detail"].lower())

    def test_rejects_oversized_streamed_body_without_content_length(self) -> None:
        app = MaxBodySizeMiddleware(_echo_app, max_bytes=64)
        status, _, _ = _run_asgi(app, method="POST", path="/api/posts", body=b"A" * 128)
        self.assertEqual(status, 413)

    def test_rejects_invalid_content_length(self) -> None:
        app = MaxBodySizeMiddleware(_echo_app, max_bytes=1024)
        status, _, _ = _run_asgi(
            app,
            method="POST",
            path="/api/posts",
            headers=[(b"content-length", b"not-a-number")],
        )
        self.assertEqual(status, 400)


class TestRateLimiting(unittest.TestCase):
    def test_rule_selection(self) -> None:
        self.assertIsNone(select_rate_limit_rule("GET", "/health"))
        self.assertIsNone(select_rate_limit_rule("GET", "/ready"))
        self.assertIsNone(select_rate_limit_rule("OPTIONS", "/api/me"))
        self.assertEqual(select_rate_limit_rule("DELETE", "/api/me").name, "account_delete")
        self.assertEqual(select_rate_limit_rule("POST", "/api/me/setup").name, "account_setup")
        self.assertEqual(select_rate_limit_rule("GET", "/api/catalog/search").name, "catalog_tmdb")

    def test_sliding_window_blocks_and_recovers(self) -> None:
        now = [100.0]
        limiter = SlidingWindowRateLimiter(clock=lambda: now[0])
        rule = RateLimitRule("test", limit=2, window_seconds=10)

        self.assertEqual(limiter.check("k1", rule), (True, 1, 0))
        self.assertEqual(limiter.check("k1", rule), (True, 0, 0))
        allowed, remaining, retry_after = limiter.check("k1", rule)
        self.assertFalse(allowed)
        self.assertEqual(remaining, 0)
        self.assertGreaterEqual(retry_after, 1)

        now[0] += 11.0
        self.assertEqual(limiter.check("k1", rule), (True, 1, 0))

    def test_middleware_returns_429_with_retry_after(self) -> None:
        limiter = SlidingWindowRateLimiter()
        app = RateLimitMiddleware(_echo_app, limiter=limiter)
        for _ in range(5):
            status, headers, _ = _run_asgi(
                app,
                method="DELETE",
                path="/api/me",
                client=("testclient", 12345),
            )
            self.assertEqual(status, 200)
            self.assertEqual(headers.get("x-ratelimit-limit"), "5")

        status, headers, _ = _run_asgi(
            app,
            method="DELETE",
            path="/api/me",
            client=("testclient", 12345),
            headers=[(b"x-forwarded-for", b"203.0.113.10")],
        )
        self.assertEqual(status, 429)
        self.assertIn("retry-after", headers)
        self.assertEqual(headers.get("x-ratelimit-remaining"), "0")


class TestRequestLoggingMiddleware(unittest.TestCase):
    def test_attaches_request_id_and_redacts_secrets(self) -> None:
        app = RequestLoggingMiddleware(_echo_app)
        with self.assertLogs("odinstream.http", level=logging.INFO) as cm:
            status, headers, _ = _run_asgi(
                app,
                method="GET",
                path="/api/me",
                headers=[
                    (b"authorization", b"Bearer super-secret-jwt-token"),
                    (b"x-request-id", b"req-abc-123"),
                ],
            )
        self.assertEqual(status, 200)
        self.assertEqual(headers.get("x-request-id"), "req-abc-123")
        joined = "\n".join(cm.output)
        self.assertIn("req-abc-123", joined)
        self.assertNotIn("super-secret-jwt-token", joined)

    def test_non_ascii_request_id_is_replaced(self) -> None:
        status, headers, _ = _run_asgi(
            RequestLoggingMiddleware(_echo_app),
            method="POST",
            headers=[(b"x-request-id", bytes([233]))],
        )
        self.assertEqual(status, 200)
        self.assertRegex(headers["x-request-id"], r"^[0-9a-f]{16}$")

    def test_rejects_malformed_caller_request_id(self) -> None:
        app = RequestLoggingMiddleware(_echo_app)
        status, headers, _ = _run_asgi(
            app,
            path="/health",
            headers=[(b"x-request-id", b"evil\r\ninjected-header")],
        )
        self.assertEqual(status, 200)
        self.assertNotIn("evil", headers.get("x-request-id", ""))
        self.assertEqual(len(headers.get("x-request-id", "")), 16)


if __name__ == "__main__":
    unittest.main()
