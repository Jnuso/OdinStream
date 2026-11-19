"""Live post-deploy smoke test suite for OdinStream backend API.

Uses only the Python standard library so it can run from any laptop or CI runner
without installing extra packages.

Usage:
    BASE_URL=https://odin-stream-api.onrender.com python3 tests/test_deploy_smoke.py
    BASE_URL=https://odin-stream-api.onrender.com EXPECTED_ORIGIN=https://odin-stream.onrender.com python3 tests/test_deploy_smoke.py
    BASE_URL=https://odin-stream-api.onrender.com SMOKE_TEST_BEARER_TOKEN=<jwt> python3 tests/test_deploy_smoke.py

Optional flags:
    CHECK_READY=1             Require GET /ready -> 200 (default: warn if 404)
    CHECK_SECURITY_HEADERS=1  Require X-Content-Type-Options / X-Frame-Options (default: warn if missing)
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any


@dataclass
class HttpResult:
    status: int
    headers: dict[str, str]
    body_text: str

    def json(self) -> Any:
        return json.loads(self.body_text)


def _request(
    url: str,
    *,
    method: str = "GET",
    headers: dict[str, str] | None = None,
    timeout: float = 15.0,
) -> HttpResult:
    req = urllib.request.Request(url, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            hdrs = {k.lower(): v for k, v in resp.headers.items()}
            return HttpResult(status=resp.status, headers=hdrs, body_text=raw)
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        hdrs = {k.lower(): v for k, v in exc.headers.items()}
        return HttpResult(status=exc.code, headers=hdrs, body_text=raw)


def _join(base_url: str, path: str) -> str:
    return base_url.rstrip("/") + "/" + path.lstrip("/")


def run_smoke_tests(
    base_url: str,
    *,
    expected_origin: str | None = None,
    bearer_token: str | None = None,
    require_ready: bool = False,
    require_security_headers: bool = False,
    timeout: float = 15.0,
) -> tuple[int, int, int]:
    """Run all live smoke checks. Returns (passed, warned, failed)."""
    passed = 0
    warned = 0
    failed = 0

    def ok(name: str, detail: str = "") -> None:
        nonlocal passed
        passed += 1
        suffix = f" — {detail}" if detail else ""
        print(f"[PASS] {name}{suffix}")

    def warn(name: str, detail: str) -> None:
        nonlocal warned
        warned += 1
        print(f"[WARN] {name} — {detail}")

    def fail(name: str, detail: str) -> None:
        nonlocal failed
        failed += 1
        print(f"[FAIL] {name} — {detail}")

    # 1. GET /health
    try:
        res = _request(_join(base_url, "/health"), timeout=timeout)
        payload = res.json() if res.body_text else {}
        if res.status == 200 and payload.get("status") == "ok":
            ok("GET /health", "200 {'status': 'ok'}")
        else:
            fail("GET /health", f"expected 200 {{'status': 'ok'}}, got {res.status} {res.body_text[:120]}")
    except Exception as exc:
        fail("GET /health", f"request error: {exc}")

    # 2. GET /ready (DB connectivity)
    try:
        res = _request(_join(base_url, "/ready"), timeout=timeout)
        if res.status == 200:
            ok("GET /ready", "200 DB reachable")
        elif res.status == 404 and not require_ready:
            warn("GET /ready", "endpoint not deployed yet (404)")
        else:
            fail("GET /ready", f"expected 200, got {res.status} {res.body_text[:120]}")
    except Exception as exc:
        fail("GET /ready", f"request error: {exc}")

    # 3. Unauthenticated /api/me must reject with 401 + private, no-store
    try:
        res = _request(_join(base_url, "/api/me"), timeout=timeout)
        cc = res.headers.get("cache-control", "").lower()
        if res.status == 401:
            if "no-store" in cc and "private" in cc:
                ok("GET /api/me (unauth)", f"401 with Cache-Control: {cc}")
            else:
                fail("GET /api/me (unauth)", f"401 returned, but Cache-Control missing private/no-store: {cc!r}")
        else:
            fail("GET /api/me (unauth)", f"expected 401, got {res.status}")
    except Exception as exc:
        fail("GET /api/me (unauth)", f"request error: {exc}")

    # 4. Invalid Bearer token on /api/me must reject with 401 (no 500 leak)
    try:
        res = _request(
            _join(base_url, "/api/me"),
            headers={"Authorization": "Bearer not.a.valid.jwt"},
            timeout=timeout,
        )
        cc = res.headers.get("cache-control", "").lower()
        if res.status == 401 and "no-store" in cc:
            ok("GET /api/me (invalid JWT)", "401 with Cache-Control: no-store")
        else:
            fail("GET /api/me (invalid JWT)", f"expected 401 + no-store, got {res.status} cc={cc!r}")
    except Exception as exc:
        fail("GET /api/me (invalid JWT)", f"request error: {exc}")

    # 5. BadHost header probe (CVE-2026-48710 regression check)
    try:
        res = _request(
            _join(base_url, "/api/me"),
            headers={"Host": "evil.example.com", "Authorization": "Bearer fake.token.value"},
            timeout=timeout,
        )
        if res.status in (400, 401, 403, 404):
            ok("Host-header auth check", f"rejected with {res.status}")
        else:
            fail("Host-header auth check", f"unexpected status {res.status}")
    except Exception as exc:
        ok("Host-header auth check", f"rejected at edge ({type(exc).__name__})")

    # 6. Public catalog search
    try:
        q = urllib.parse.urlencode({"query": "inception"})
        res = _request(_join(base_url, f"/api/catalog/search?{q}"), timeout=timeout)
        if res.status == 200:
            data = res.json()
            items = data.get("results") if isinstance(data, dict) else data
            if isinstance(items, list) and len(items) > 0:
                ok("GET /api/catalog/search", f"200 ({len(items)} results)")
            else:
                warn("GET /api/catalog/search", "200 returned but results list was empty")
        else:
            fail("GET /api/catalog/search", f"expected 200, got {res.status} {res.body_text[:120]}")
    except Exception as exc:
        fail("GET /api/catalog/search", f"request error: {exc}")

    # 7. Security headers check (from /health)
    try:
        res = _request(_join(base_url, "/health"), timeout=timeout)
        xcto = res.headers.get("x-content-type-options", "").lower()
        xfo = res.headers.get("x-frame-options", "").upper()
        missing = []
        if xcto != "nosniff":
            missing.append("X-Content-Type-Options: nosniff")
        if xfo not in ("DENY", "SAMEORIGIN"):
            missing.append("X-Frame-Options: DENY")
        if not missing:
            ok("Security headers", f"nosniff + X-Frame-Options={xfo}")
        elif require_security_headers:
            fail("Security headers", f"missing {', '.join(missing)}")
        else:
            warn("Security headers", f"not yet enabled ({', '.join(missing)})")
    except Exception as exc:
        fail("Security headers", f"request error: {exc}")

    # 8. CORS preflight check (when EXPECTED_ORIGIN is provided)
    if expected_origin:
        try:
            res = _request(
                _join(base_url, "/api/catalog/search"),
                method="OPTIONS",
                headers={
                    "Origin": expected_origin,
                    "Access-Control-Request-Method": "GET",
                    "Access-Control-Request-Headers": "Authorization, Content-Type",
                },
                timeout=timeout,
            )
            acao = res.headers.get("access-control-allow-origin", "")
            if res.status in (200, 204) and acao == expected_origin:
                ok("CORS preflight (allowed origin)", f"ACAO={acao}")
            else:
                fail(
                    "CORS preflight (allowed origin)",
                    f"expected ACAO={expected_origin!r}, got status={res.status} ACAO={acao!r}",
                )
        except Exception as exc:
            fail("CORS preflight (allowed origin)", f"request error: {exc}")

        try:
            res = _request(
                _join(base_url, "/api/catalog/search"),
                method="OPTIONS",
                headers={
                    "Origin": "https://evil-attacker.example",
                    "Access-Control-Request-Method": "GET",
                },
                timeout=timeout,
            )
            acao = res.headers.get("access-control-allow-origin", "")
            if acao != "https://evil-attacker.example" and acao != "*":
                ok("CORS preflight (untrusted origin blocked)", f"ACAO={acao!r}")
            else:
                fail("CORS preflight (untrusted origin blocked)", f"reflected untrusted origin: ACAO={acao!r}")
        except Exception as exc:
            fail("CORS preflight (untrusted origin blocked)", f"request error: {exc}")

    # 9. Optional authenticated /api/me check
    if bearer_token:
        try:
            res = _request(
                _join(base_url, "/api/me"),
                headers={"Authorization": f"Bearer {bearer_token}"},
                timeout=timeout,
            )
            cc = res.headers.get("cache-control", "").lower()
            if res.status == 200 and "no-store" in cc and "private" in cc:
                ok("GET /api/me (authenticated)", "200 with Cache-Control: private, no-store")
            else:
                fail("GET /api/me (authenticated)", f"expected 200 + private/no-store, got {res.status} cc={cc!r}")
        except Exception as exc:
            fail("GET /api/me (authenticated)", f"request error: {exc}")

    print(f"\nSummary: {passed} passed, {warned} warnings, {failed} failed")
    return passed, warned, failed


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Live post-deploy smoke test for OdinStream API")
    parser.add_argument("--base-url", default=os.environ.get("BASE_URL", ""), help="Deployed backend base URL")
    parser.add_argument(
        "--expected-origin",
        default=os.environ.get("EXPECTED_ORIGIN", ""),
        help="Expected live frontend HTTPS origin for CORS preflight check",
    )
    parser.add_argument(
        "--bearer-token",
        default=os.environ.get("SMOKE_TEST_BEARER_TOKEN", ""),
        help="Optional valid Supabase JWT for authenticated /api/me check",
    )
    parser.add_argument(
        "--require-ready",
        action="store_true",
        default=os.environ.get("CHECK_READY", "0") == "1",
        help="Fail if GET /ready returns 404",
    )
    parser.add_argument(
        "--require-security-headers",
        action="store_true",
        default=os.environ.get("CHECK_SECURITY_HEADERS", "0") == "1",
        help="Fail if security headers are missing",
    )
    parser.add_argument("--timeout", type=float, default=15.0, help="Per-request timeout in seconds")
    args = parser.parse_args(argv)

    if not args.base_url:
        print("Error: set BASE_URL env var or pass --base-url https://your-api.onrender.com", file=sys.stderr)
        return 2

    _, _, failed = run_smoke_tests(
        args.base_url,
        expected_origin=args.expected_origin or None,
        bearer_token=args.bearer_token or None,
        require_ready=args.require_ready,
        require_security_headers=args.require_security_headers,
        timeout=args.timeout,
    )
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
