"""Reusable security, rate-limiting, payload-limit, and request-logging ASGI middleware for OdinStream.

All path checks use ASGI ``scope["path"]`` (never ``request.url.path``) to remain
immune to Host-header path-parsing discrepancies (CVE-2026-48710).
"""

from __future__ import annotations

import json
import logging
import math
import threading
import time
import uuid
from collections import deque
from dataclasses import dataclass
from typing import Any, Callable

logger = logging.getLogger("odinstream.http")

DEFAULT_SECURITY_HEADERS: tuple[tuple[bytes, bytes], ...] = (
    (b"x-content-type-options", b"nosniff"),
    (b"x-frame-options", b"DENY"),
    (b"referrer-policy", b"strict-origin-when-cross-origin"),
    (b"permissions-policy", b"camera=(), microphone=(), geolocation=()"),
)


def _get_header(headers: list[tuple[bytes, bytes]], name: bytes) -> str:
    target = name.lower()
    for k, v in headers:
        if k.lower() == target:
            return v.decode("latin-1").strip()
    return ""


def _client_ip(scope: dict[str, Any], *, trust_proxy_headers: bool = True) -> str:
    if trust_proxy_headers:
        xff = _get_header(scope.get("headers", []), b"x-forwarded-for")
        if xff:
            first = xff.split(",")[0].strip()
            if first:
                return first
    client = scope.get("client")
    if client and isinstance(client, (tuple, list)) and client[0]:
        return str(client[0])
    return "unknown"


async def _send_json_error(
    send: Callable[[dict[str, Any]], Any],
    status: int,
    detail: str,
    *,
    extra_headers: list[tuple[bytes, bytes]] | None = None,
) -> None:
    body = json.dumps({"detail": detail}).encode("utf-8")
    headers: list[tuple[bytes, bytes]] = [
        (b"content-type", b"application/json"),
        (b"content-length", str(len(body)).encode("ascii")),
        *DEFAULT_SECURITY_HEADERS,
    ]
    if extra_headers:
        headers.extend(extra_headers)
    await send({"type": "http.response.start", "status": status, "headers": headers})
    await send({"type": "http.response.body", "body": body, "more_body": False})


@dataclass(frozen=True)
class RateLimitRule:
    name: str
    limit: int
    window_seconds: int


class SlidingWindowRateLimiter:
    """Thread-safe in-memory sliding-window rate limiter suitable for single-instance Render deployments."""

    def __init__(self, *, clock: Callable[[], float] = time.monotonic, max_keys: int = 10_000) -> None:
        self._clock = clock
        self._max_keys = max_keys
        self._lock = threading.Lock()
        self._buckets: dict[str, deque[float]] = {}

    def check(self, key: str, rule: RateLimitRule) -> tuple[bool, int, int]:
        """Record a hit if allowed.

        Returns ``(allowed, remaining, retry_after_seconds)``.
        """
        now = self._clock()
        cutoff = now - rule.window_seconds
        with self._lock:
            if key not in self._buckets and len(self._buckets) >= self._max_keys:
                self._evict_stale(now, rule.window_seconds)
            bucket = self._buckets.setdefault(key, deque())
            while bucket and bucket[0] <= cutoff:
                bucket.popleft()
            if len(bucket) >= rule.limit:
                retry_after = max(1, math.ceil(rule.window_seconds - (now - bucket[0])))
                return False, 0, retry_after
            bucket.append(now)
            remaining = max(0, rule.limit - len(bucket))
            return True, remaining, 0

    def _evict_stale(self, now: float, window_seconds: int) -> None:
        cutoff = now - window_seconds
        stale = [k for k, q in self._buckets.items() if not q or q[-1] <= cutoff]
        for k in stale:
            del self._buckets[k]
        if len(self._buckets) >= self._max_keys:
            drop_count = max(1, len(self._buckets) // 4)
            for k in list(self._buckets.keys())[:drop_count]:
                del self._buckets[k]

    def reset(self) -> None:
        with self._lock:
            self._buckets.clear()


def select_rate_limit_rule(method: str, path: str) -> RateLimitRule | None:
    """Map an HTTP method + ASGI scope path to a rate-limit bucket, or None if exempt."""
    m = method.upper()
    if m == "OPTIONS" or path in ("/health", "/ready"):
        return None
    if path == "/api/me" and m == "DELETE":
        return RateLimitRule("account_delete", limit=5, window_seconds=300)
    if path == "/api/me/setup" and m in ("POST", "PUT", "PATCH"):
        return RateLimitRule("account_setup", limit=15, window_seconds=300)
    if path.startswith("/api/catalog/") or path.startswith("/api/me/catalog/"):
        return RateLimitRule("catalog_tmdb", limit=60, window_seconds=60)
    if m in ("POST", "PUT", "PATCH", "DELETE") and path.startswith("/api/"):
        return RateLimitRule("api_writes", limit=60, window_seconds=60)
    if path.startswith("/api/"):
        return RateLimitRule("api_reads", limit=120, window_seconds=60)
    return None


class SecurityHeadersMiddleware:
    """Attach baseline defensive HTTP security headers to every HTTP response."""

    def __init__(self, app: Any) -> None:
        self.app = app

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_headers(message: dict[str, Any]) -> None:
            if message.get("type") == "http.response.start":
                headers = list(message.get("headers", []))
                existing = {k.lower() for k, _ in headers}
                for key, val in DEFAULT_SECURITY_HEADERS:
                    if key not in existing:
                        headers.append((key, val))
                message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, send_with_headers)


class MaxBodySizeMiddleware:
    """Reject HTTP request bodies larger than ``max_bytes`` with 413 Payload Too Large."""

    def __init__(self, app: Any, *, max_bytes: int = 64 * 1024) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        content_length = _get_header(scope.get("headers", []), b"content-length")
        if content_length:
            try:
                if int(content_length) > self.max_bytes:
                    await _send_json_error(send, 413, "Request payload too large.")
                    return
            except ValueError:
                await _send_json_error(send, 400, "Invalid Content-Length header.")
                return

        total = 0
        exceeded = False

        async def limited_receive() -> dict[str, Any]:
            nonlocal total, exceeded
            msg = await receive()
            if msg.get("type") == "http.request":
                chunk = msg.get("body", b"")
                total += len(chunk)
                if total > self.max_bytes:
                    exceeded = True
                    raise _PayloadTooLargeError()
            return msg

        try:
            await self.app(scope, limited_receive, send)
        except _PayloadTooLargeError:
            if exceeded:
                await _send_json_error(send, 413, "Request payload too large.")


class _PayloadTooLargeError(Exception):
    pass


class RateLimitMiddleware:
    """Per-IP sliding-window rate limiter for TMDB proxy and mutating API routes."""

    def __init__(
        self,
        app: Any,
        *,
        limiter: SlidingWindowRateLimiter | None = None,
        enabled: bool = True,
        trust_proxy_headers: bool = True,
        rate_limit_testclient: bool = False,
    ) -> None:
        self.app = app
        self.limiter = limiter or SlidingWindowRateLimiter()
        self.enabled = enabled
        self.trust_proxy_headers = trust_proxy_headers
        self.rate_limit_testclient = rate_limit_testclient

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope.get("type") != "http" or not self.enabled:
            await self.app(scope, receive, send)
            return

        method = scope.get("method", "GET")
        path = scope.get("path", "")
        rule = select_rate_limit_rule(method, path)
        if rule is None:
            await self.app(scope, receive, send)
            return

        ip = _client_ip(scope, trust_proxy_headers=self.trust_proxy_headers)
        if ip == "testclient" and not self.rate_limit_testclient:
            await self.app(scope, receive, send)
            return

        key = f"{rule.name}:{ip}"
        allowed, remaining, retry_after = self.limiter.check(key, rule)
        if not allowed:
            await _send_json_error(
                send,
                429,
                "Too many requests. Please slow down and try again.",
                extra_headers=[
                    (b"retry-after", str(retry_after).encode("ascii")),
                    (b"x-ratelimit-limit", str(rule.limit).encode("ascii")),
                    (b"x-ratelimit-remaining", b"0"),
                ],
            )
            return

        async def send_with_ratelimit(message: dict[str, Any]) -> None:
            if message.get("type") == "http.response.start":
                headers = list(message.get("headers", []))
                headers.append((b"x-ratelimit-limit", str(rule.limit).encode("ascii")))
                headers.append((b"x-ratelimit-remaining", str(remaining).encode("ascii")))
                message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, send_with_ratelimit)


class RequestLoggingMiddleware:
    """Attach X-Request-ID and emit structured request logs without leaking secrets."""

    def __init__(self, app: Any) -> None:
        self.app = app

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        incoming_id = _get_header(scope.get("headers", []), b"x-request-id")
        if incoming_id and len(incoming_id) <= 64 and all(c.isalnum() or c in "-_." for c in incoming_id):
            request_id = incoming_id
        else:
            request_id = uuid.uuid4().hex[:16]

        start = time.perf_counter()
        status_code = 500

        async def send_with_request_id(message: dict[str, Any]) -> None:
            nonlocal status_code
            if message.get("type") == "http.response.start":
                status_code = int(message.get("status", 500))
                headers = list(message.get("headers", []))
                headers.append((b"x-request-id", request_id.encode("ascii")))
                message = {**message, "headers": headers}
            await send(message)

        try:
            await self.app(scope, receive, send_with_request_id)
        finally:
            duration_ms = round((time.perf_counter() - start) * 1000.0, 2)
            logger.info(
                "http_request request_id=%s method=%s path=%s status=%d duration_ms=%.2f",
                request_id,
                scope.get("method", "GET"),
                scope.get("path", ""),
                status_code,
                duration_ms,
            )
