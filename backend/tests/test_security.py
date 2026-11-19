"""Comprehensive defensive security regression tests for the Odin Stream FastAPI backend.

Covers OWASP API Security Top 10 controls and historical CVEs relevant to
FastAPI, Starlette, PyJWT, psycopg, and Supabase Auth:
- JWT algorithm allow-list, alg=none rejection, JWKS error handling,
  issuer prefix spoofing (CVE-2024-53861), unknown `crit` headers (CVE-2026-32597),
  role/claim validation, and fail-closed config
- Setup-complete gate enforcement across all protected routes and Host-header
  path consistency (CVE-2026-48710)
- Broken Object Level Authorization (BOLA/IDOR) across library, episodes, posts,
  private profiles, and follow requests
- Mass assignment (`extra="forbid"`) and strict input/type/bounds validation
- Catalog, service-filtered search, and recommendation abuse/boundary checks
- Account deletion fail-closed checks (HTTPS enforcement, identity match, key headers)
- CORS origin enforcement, Cache-Control headers, and error-response hygiene
"""

from __future__ import annotations

import base64
import io
import json
import time
import unittest
from datetime import datetime, timezone
from unittest.mock import patch
from urllib.error import HTTPError
from uuid import uuid4

import jwt
from fastapi.testclient import TestClient

from app.accounts import preference_store
from app.errors import APIError
from app.library import library_store
from app.main import app
from app.settings import Settings, get_settings
from app.social import shape_post, social_store

TEST_SECRET = "security-test-secret-that-is-well-over-32-bytes-long"
SUPABASE_URL = "https://example.supabase.co"


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _make_token(
    user_id: str | int | None,
    *,
    secret: str = TEST_SECRET,
    issuer: str | None = f"{SUPABASE_URL}/auth/v1",
    algorithm: str = "HS256",
    headers: dict | None = None,
    omit: tuple[str, ...] = (),
    **overrides,
) -> str:
    claims: dict = {
        "sub": user_id,
        "email": "viewer@example.test",
        "aud": "authenticated",
        "iss": issuer,
        "exp": int(time.time()) + 600,
        "role": "authenticated",
    }
    claims.update(overrides)
    for key in omit:
        claims.pop(key, None)
    return jwt.encode(claims, secret, algorithm=algorithm, headers=headers)


class _FakeLibraryStore:
    def __init__(self) -> None:
        self.rows: dict = {}
        self.progress: dict = {}

    def list(self, user_id, media_type, status, limit=None, offset=0):
        rows = [
            row
            for owner, row in self.rows.values()
            if owner == user_id
            and (media_type is None or row["media_type"] == media_type)
            and (status is None or row["status"] == status)
        ]
        return rows[offset : offset + limit] if limit is not None else rows[offset:]

    def create(self, user_id, media_type, tmdb_id, status):
        entry_id = uuid4()
        row = {"id": str(entry_id), "media_type": media_type, "tmdb_id": tmdb_id, "status": status}
        self.rows[entry_id] = (user_id, row)
        return row

    def get(self, user_id, entry_id):
        item = self.rows.get(entry_id)
        return item[1] if item and item[0] == user_id else None

    def update(self, user_id, entry_id, status):
        row = self.get(user_id, entry_id)
        if row is not None:
            row["status"] = status
        return row

    def delete(self, user_id, entry_id):
        if self.get(user_id, entry_id) is None:
            return None
        return self.rows.pop(entry_id)[1]

    def episodes(self, user_id, entry_id):
        return []

    def mark_episodes(self, user_id, entry_id, season, numbers, *, bulk=False):
        return numbers

    def unmark_episodes(self, user_id, entry_id, season, numbers=None):
        return []


class _FakeSocialStore:
    def __init__(self, owner_id: str, viewer_id: str) -> None:
        self.owner_id = owner_id
        self.viewer_id = viewer_id
        self.followers: set[tuple[str, str]] = set()
        self.profiles_map = {
            owner_id: {
                "id": owner_id,
                "display_name": "Owner",
                "handle": "owner.1",
                "bio": "Private bio",
                "visibility": "private",
            },
            viewer_id: {
                "id": viewer_id,
                "display_name": "Viewer",
                "handle": "viewer.2",
                "bio": "",
                "visibility": "public",
            },
        }
        self.posts: dict = {}
        self.requests_by_owner: dict[str, set[str]] = {owner_id: {viewer_id}}

    def profile(self, viewer_id, target_id):
        row = self.profiles_map.get(target_id)
        if row is None:
            raise APIError(404, "profile_not_found", "Profile not found.")
        follows = (viewer_id, target_id) in self.followers
        requested = viewer_id in self.requests_by_owner.get(target_id, set())
        can_view = row["visibility"] == "public" or viewer_id == target_id or follows
        return {
            **row,
            "bio": row["bio"] if can_view else "",
            "post_count": 0,
            "follower_count": 0,
            "following_count": 0,
            "can_view_posts": can_view,
            "viewer_follows": follows,
            "viewer_requested": requested,
        }

    def profiles(self, viewer_id, limit):
        return [self.profile(viewer_id, pid) for pid in list(self.profiles_map)[:limit] if pid != viewer_id]

    def feed(self, user_id, scope, limit, offset):
        return []

    def posts_by_author(self, viewer_id, target_id, limit, offset):
        return [shape_post(p) for p in self.posts.values() if p["author_id"] == target_id][offset : offset + limit]

    def posts_for_title(self, user_id, media_type, tmdb_id, limit):
        return []

    def create(self, user_id, media_type, tmdb_id, title, rating, review):
        post_id = str(uuid4())
        row = {
            "id": post_id,
            "media_type": media_type,
            "tmdb_id": tmdb_id,
            "title_name": title["name"],
            "poster_path": title["poster_path"],
            "release_date": title["release_date"],
            "rating": rating,
            "review": review,
            "created_at": datetime.now(timezone.utc),
            "updated_at": datetime.now(timezone.utc),
            "author_id": user_id,
            "author_name": "Owner",
            "author_handle": "owner.1",
        }
        self.posts[post_id] = row
        return shape_post(row)

    def update(self, user_id, post_id, rating, review):
        row = self.posts.get(str(post_id))
        if row is None or row["author_id"] != user_id:
            raise APIError(404, "post_not_found", "Post not found.")
        row.update(rating=rating, review=review)
        return shape_post(row)

    def delete(self, user_id, post_id):
        row = self.posts.get(str(post_id))
        if row is None or row["author_id"] != user_id:
            raise APIError(404, "post_not_found", "Post not found.")
        self.posts.pop(str(post_id))

    def update_profile(self, user_id, display_name, handle, bio):
        self.profiles_map[user_id].update(display_name=display_name, handle=handle, bio=bio)
        return self.profile(user_id, user_id)

    def set_visibility(self, user_id, visibility):
        self.profiles_map[user_id]["visibility"] = visibility
        return self.profile(user_id, user_id)

    def requests(self, user_id, limit, offset):
        return [{"user_id": r} for r in self.requests_by_owner.get(user_id, set())][offset : offset + limit]

    def resolve_request(self, user_id, requester_id, approve):
        if requester_id not in self.requests_by_owner.get(user_id, set()):
            raise APIError(404, "request_not_found", "Follow request not found.")
        self.requests_by_owner[user_id].remove(requester_id)
        if approve:
            self.followers.add((requester_id, user_id))

    def remove_follower(self, user_id, follower_id):
        self.followers.discard((follower_id, user_id))

    def follow(self, user_id, profile_id):
        self.profile(user_id, profile_id)
        self.requests_by_owner.setdefault(profile_id, set()).add(user_id)

    def unfollow(self, user_id, profile_id):
        self.followers.discard((user_id, profile_id))
        self.requests_by_owner.get(profile_id, set()).discard(user_id)


class _FakePreferenceStore:
    def __init__(self, services: list[str] | None = None, genres: list[str] | None = None) -> None:
        self.services = list(services or [])
        self.genres = list(genres or [])

    def get(self, user_id):
        return {"favorite_genres": list(self.genres), "streaming_services": list(self.services)}

    def save(self, user_id, genres, services):
        self.genres = list(genres)
        self.services = list(services)
        return self.get(user_id)


class _FakeResponse:
    def __init__(self, payload: dict) -> None:
        self._payload = json.dumps(payload).encode()

    def __enter__(self):
        return io.BytesIO(self._payload)

    def __exit__(self, *args):
        pass


class SecurityBaseTest(unittest.TestCase):
    def setUp(self) -> None:
        self.user_a = str(uuid4())
        self.user_b = str(uuid4())
        self.user_c = str(uuid4())
        self.settings = Settings(
            SUPABASE_URL,
            TEST_SECRET,
            "",
            ("https://app.odinstream.example",),
        )
        self.library = _FakeLibraryStore()
        self.social = _FakeSocialStore(self.user_a, self.user_b)
        self.preferences = _FakePreferenceStore(services=["Netflix"], genres=["Drama"])
        app.dependency_overrides[get_settings] = lambda: self.settings
        app.dependency_overrides[library_store] = lambda: self.library
        app.dependency_overrides[social_store] = lambda: self.social
        app.dependency_overrides[preference_store] = lambda: self.preferences
        self.client = TestClient(app)

    def tearDown(self) -> None:
        app.dependency_overrides.clear()

    def auth_headers(self, user_id: str | int | None, **token_kwargs) -> dict[str, str]:
        return {"Authorization": f"Bearer {_make_token(user_id, **token_kwargs)}"}


class TestJWTSecurity(SecurityBaseTest):
    """Verify JWT validation blocks alg=none, algorithm confusion, and spoofed claims."""

    def test_rejects_alg_none_and_missing_alg(self) -> None:
        payload = _b64url(
            json.dumps(
                {
                    "sub": self.user_a,
                    "aud": "authenticated",
                    "iss": self.settings.issuer,
                    "exp": int(time.time()) + 600,
                    "role": "authenticated",
                }
            ).encode()
        )
        for header_obj in ({"alg": "none", "typ": "JWT"}, {"typ": "JWT"}):
            with self.subTest(header=header_obj):
                token = f"{_b64url(json.dumps(header_obj).encode())}.{payload}."
                response = self.client.get("/api/me", headers={"Authorization": f"Bearer {token}"})
                self.assertEqual(response.status_code, 401)

    def test_rejects_disallowed_algorithms(self) -> None:
        for alg in ("HS384", "HS512"):
            with self.subTest(alg=alg):
                token = _make_token(self.user_a, algorithm=alg)
                self.assertEqual(self.client.get("/api/me", headers={"Authorization": f"Bearer {token}"}).status_code, 401)
        token = _make_token(self.user_a)
        with patch("app.auth.jwt.get_unverified_header", return_value={"alg": "PS256"}):
            self.assertEqual(self.client.get("/api/me", headers={"Authorization": f"Bearer {token}"}).status_code, 401)

    def test_rejects_prefix_spoofed_issuer(self) -> None:
        spoofed_iss = f"{self.settings.issuer}.attacker.example"
        response = self.client.get("/api/me", headers=self.auth_headers(self.user_a, issuer=spoofed_iss))
        self.assertEqual(response.status_code, 401)

    def test_rejects_unknown_crit_header_extension(self) -> None:
        token = _make_token(self.user_a, headers={"crit": ["x-unsupported-ext"], "x-unsupported-ext": True})
        response = self.client.get("/api/me", headers={"Authorization": f"Bearer {token}"})
        self.assertEqual(response.status_code, 401)

    def test_rejects_missing_required_claims_and_invalid_subjects(self) -> None:
        bad_headers = [
            {},
            {"Authorization": "Basic dXNlcjpwYXNz"},
            {"Authorization": "Bearer "},
            {"Authorization": "Bearer    "},
            {"Authorization": "Bearer not.a.jwt"},
            self.auth_headers("not-a-uuid"),
            self.auth_headers(12345),
            self.auth_headers(self.user_a, omit=("exp",)),
            self.auth_headers(self.user_a, omit=("sub",)),
            self.auth_headers(self.user_a, omit=("aud",)),
            self.auth_headers(self.user_a, omit=("iss",)),
            self.auth_headers(self.user_a, omit=("role",)),
            self.auth_headers(self.user_a, role="service_role"),
            self.auth_headers(self.user_a, role="anon"),
            self.auth_headers(self.user_a, aud="wrong-audience"),
            self.auth_headers(self.user_a, exp=int(time.time()) - 10),
        ]
        for headers in bad_headers:
            with self.subTest(headers=headers):
                self.assertEqual(self.client.get("/api/me", headers=headers).status_code, 401)

    def test_accepts_case_insensitive_bearer_scheme(self) -> None:
        token = _make_token(self.user_a)
        for prefix in ("Bearer", "bearer", "BEARER"):
            with self.subTest(prefix=prefix):
                response = self.client.get("/api/me", headers={"Authorization": f"{prefix} {token}"})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()["id"], self.user_a)

    def test_jwks_errors_and_empty_secrets_fail_closed(self) -> None:
        token = _make_token(self.user_a)
        with patch("app.auth.jwt.get_unverified_header", return_value={"alg": "ES256"}):
            with patch("app.auth._decode_asymmetric", side_effect=jwt.PyJWKClientConnectionError("timeout")):
                self.assertEqual(self.client.get("/api/me", headers={"Authorization": f"Bearer {token}"}).status_code, 503)
            with patch("app.auth._decode_asymmetric", side_effect=jwt.PyJWKSetError("bad jwks")):
                self.assertEqual(self.client.get("/api/me", headers={"Authorization": f"Bearer {token}"}).status_code, 401)
        app.dependency_overrides[get_settings] = lambda: Settings(SUPABASE_URL, "", "", ())
        self.assertEqual(self.client.get("/api/me", headers={"Authorization": f"Bearer {token}"}).status_code, 401)


class TestSetupGateAndHostHeader(SecurityBaseTest):
    """Verify incomplete accounts are gated and Host header quirks cannot bypass the gate."""

    def _enable_db_gate(self) -> None:
        app.dependency_overrides[get_settings] = lambda: Settings(
            SUPABASE_URL,
            TEST_SECRET,
            "postgresql://odin_api_login:pw@localhost:5432/postgres",
            ("https://app.odinstream.example",),
        )

    def test_incomplete_account_blocked_from_all_protected_routes(self) -> None:
        self._enable_db_gate()
        headers = self.auth_headers(self.user_a)
        protected_routes = (
            "/api/me",
            "/api/me/preferences",
            "/api/me/saved-titles",
            "/api/me/recommendations",
            "/api/me/catalog/search?query=Dune",
            "/api/feed",
            "/api/profiles",
            f"/api/profiles/{self.user_b}",
            "/api/me/profile",
            "/api/me/follow-requests",
        )
        with patch("app.accounts.setup_complete", return_value=False):
            for path in protected_routes:
                with self.subTest(path=path):
                    response = self.client.get(path, headers=headers)
                    self.assertEqual(response.status_code, 403)
                    self.assertEqual(response.json()["error"], "setup_required")
            setup_status = self.client.get("/api/me/setup", headers=headers)
            self.assertEqual(setup_status.status_code, 200)
            self.assertEqual(setup_status.json(), {"setup_complete": False})

    def test_setup_gate_fails_closed_on_database_outage(self) -> None:
        self._enable_db_gate()
        headers = self.auth_headers(self.user_a)
        with patch(
            "app.accounts.setup_complete",
            side_effect=APIError(503, "account_unavailable", "Account setup is temporarily unavailable."),
        ):
            response = self.client.get("/api/me", headers=headers)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["error"], "account_unavailable")

    def test_host_header_cannot_bypass_setup_gate(self) -> None:
        self._enable_db_gate()
        headers = {
            **self.auth_headers(self.user_a),
            "Host": "api.odinstream.example/api/me/setup#",
        }
        with patch("app.accounts.setup_complete", return_value=False):
            response = self.client.get("/api/me/saved-titles", headers=headers)
        self.assertIn(response.status_code, (400, 403))
        self.assertNotEqual(response.status_code, 200)


class TestOwnerIsolationAndPrivacy(SecurityBaseTest):
    """Verify BOLA/IDOR protections across library items, episodes, posts, and private profiles."""

    def test_cross_user_library_and_episode_mutation_denied(self) -> None:
        a = self.auth_headers(self.user_a)
        b = self.auth_headers(self.user_b)
        with patch("app.library.tmdb_get", return_value={"id": 1396}):
            created = self.client.post(
                "/api/me/saved-titles",
                headers=a,
                json={"media_type": "tv", "tmdb_id": 1396, "status": "watching"},
            )
        self.assertEqual(created.status_code, 201)
        entry_id = created.json()["id"]

        self.assertEqual(self.client.patch(f"/api/me/saved-titles/{entry_id}", headers=b, json={"status": "dropped"}).status_code, 404)
        self.assertEqual(self.client.delete(f"/api/me/saved-titles/{entry_id}", headers=b).status_code, 404)
        self.assertEqual(self.client.get(f"/api/me/saved-titles/{entry_id}/episodes", headers=b).status_code, 404)
        self.assertEqual(self.client.put(f"/api/me/saved-titles/{entry_id}/seasons/1/episodes/1", headers=b).status_code, 404)
        self.assertEqual(self.client.delete(f"/api/me/saved-titles/{entry_id}/seasons/1/episodes/1", headers=b).status_code, 404)
        self.assertEqual(self.client.put(f"/api/me/saved-titles/{entry_id}/seasons/1/episodes", headers=b).status_code, 404)
        self.assertEqual(self.client.delete(f"/api/me/saved-titles/{entry_id}/seasons/1/episodes", headers=b).status_code, 404)

    def test_cross_user_post_mutation_and_private_profile_access_denied(self) -> None:
        a = self.auth_headers(self.user_a)
        b = self.auth_headers(self.user_b)
        c = self.auth_headers(self.user_c)
        with patch(
            "app.social.tmdb_get",
            return_value={"id": 603, "title": "The Matrix", "poster_path": None, "release_date": "1999-03-31"},
        ):
            post = self.client.post("/api/titles/movie/603/posts", headers=a, json={"rating": 4.5, "review": "Classic."})
        self.assertEqual(post.status_code, 201)
        post_id = post.json()["id"]

        self.assertEqual(self.client.patch(f"/api/posts/{post_id}", headers=b, json={"rating": 1.0}).status_code, 404)
        self.assertEqual(self.client.delete(f"/api/posts/{post_id}", headers=b).status_code, 404)
        self.assertEqual(self.client.get(f"/api/profiles/{self.user_a}/posts", headers=b).status_code, 403)
        self.assertEqual(self.client.get(f"/api/profiles/{self.user_a}/posts", headers=c).status_code, 403)
        self.assertEqual(self.client.get(f"/api/profiles/{self.user_a}/posts", headers=a).status_code, 200)
        self.assertEqual(self.client.post(f"/api/me/follow-requests/{self.user_b}/approve", headers=c).status_code, 404)
        self.assertEqual(self.client.post(f"/api/me/follow-requests/{self.user_b}/decline", headers=c).status_code, 404)
        self.assertEqual(self.client.post(f"/api/me/follow-requests/{self.user_b}/approve", headers=a).status_code, 204)
        self.assertEqual(self.client.get(f"/api/profiles/{self.user_a}/posts", headers=b).status_code, 200)
        self.assertEqual(self.client.delete(f"/api/me/followers/{self.user_b}", headers=a).status_code, 204)
        self.assertEqual(self.client.get(f"/api/profiles/{self.user_a}/posts", headers=b).status_code, 403)
        self.assertEqual(self.client.put(f"/api/profiles/{self.user_a}/follow", headers=a).status_code, 422)


class TestInputValidationAndMassAssignment(SecurityBaseTest):
    """Verify Pydantic extra='forbid', strict types, and bounds validation."""

    def test_mass_assignment_extra_fields_rejected(self) -> None:
        headers = self.auth_headers(self.user_a)
        cases = [
            ("POST", "/api/me/saved-titles", {"media_type": "movie", "tmdb_id": 603, "status": "watchlist", "user_id": self.user_b}),
            ("POST", "/api/titles/movie/603/posts", {"rating": 4.0, "user_id": self.user_b}),
            ("PATCH", "/api/me/profile", {"display_name": "A", "handle": "valid_user", "visibility": "public"}),
            ("PATCH", "/api/me/profile/visibility", {"visibility": "public", "setup_complete": True}),
            ("PUT", "/api/me/setup", {"username": "valid_user", "visibility": "public", "role": "admin"}),
            ("DELETE", "/api/me", {"password": "pw", "user_id": self.user_b}),
        ]
        for method, path, body in cases:
            with self.subTest(method=method, path=path):
                response = self.client.request(method, path, headers=headers, json=body)
                self.assertEqual(response.status_code, 422)
                self.assertEqual(response.json()["error"], "validation_error")

    def test_rejects_invalid_handles_display_names_and_bios(self) -> None:
        headers = self.auth_headers(self.user_a)
        for handle in ("ab", "a" * 31, "bad handle", "admin';--", "<script>", "user/name", "üsername"):
            with self.subTest(handle=handle):
                response = self.client.patch(
                    "/api/me/profile",
                    headers=headers,
                    json={"display_name": "Tester", "handle": handle, "bio": ""},
                )
                self.assertEqual(response.status_code, 422)
        self.assertEqual(
            self.client.patch("/api/me/profile", headers=headers, json={"display_name": "   ", "handle": "ok_user", "bio": ""}).status_code,
            422,
        )
        self.assertEqual(
            self.client.patch("/api/me/profile", headers=headers, json={"display_name": "A" * 61, "handle": "ok_user", "bio": ""}).status_code,
            422,
        )
        self.assertEqual(
            self.client.patch("/api/me/profile", headers=headers, json={"display_name": "Ok", "handle": "ok_user", "bio": "x" * 281}).status_code,
            422,
        )

    def test_rejects_invalid_tmdb_ids_media_types_statuses_and_ratings(self) -> None:
        headers = self.auth_headers(self.user_a)
        for bad_library in (
            {"media_type": "person", "tmdb_id": 1, "status": "watchlist"},
            {"media_type": "movie", "tmdb_id": 0, "status": "watchlist"},
            {"media_type": "movie", "tmdb_id": -5, "status": "watchlist"},
            {"media_type": "movie", "tmdb_id": 2**63, "status": "watchlist"},
            {"media_type": "movie", "tmdb_id": True, "status": "watchlist"},
            {"media_type": "movie", "tmdb_id": 1, "status": "watching"},
            {"media_type": "tv", "tmdb_id": 1, "status": "watched"},
        ):
            with self.subTest(body=bad_library):
                self.assertEqual(self.client.post("/api/me/saved-titles", headers=headers, json=bad_library).status_code, 422)

        for bad_post in (
            {"rating": 0},
            {"rating": 0.25},
            {"rating": 5.5},
            {"rating": True},
            {"rating": "4.5"},
            {"rating": 4.0, "review": "x" * 2001},
        ):
            with self.subTest(post=bad_post):
                self.assertEqual(self.client.post("/api/titles/movie/603/posts", headers=headers, json=bad_post).status_code, 422)

        bad_uuid = self.client.patch("/api/me/saved-titles/not-a-uuid", headers=headers, json={"status": "watched"})
        self.assertEqual(bad_uuid.status_code, 422)


class TestCatalogAndRecommendationsSecurity(SecurityBaseTest):
    """Verify catalog and recommendation bounds, TMDB mismatch checks, and auth gates."""

    def test_catalog_query_and_path_bounds(self) -> None:
        self.assertEqual(self.client.get("/api/catalog/search", params={"query": "   "}).status_code, 422)
        self.assertEqual(self.client.get("/api/catalog/search", params={"query": "a" * 201}).status_code, 422)
        self.assertEqual(self.client.get("/api/catalog/search", params={"query": "a", "page": 0}).status_code, 422)
        self.assertEqual(self.client.get("/api/catalog/search", params={"query": "a", "page": 501}).status_code, 422)
        self.assertEqual(self.client.get("/api/catalog/movie/0").status_code, 422)
        self.assertEqual(self.client.get("/api/catalog/person/1").status_code, 422)
        self.assertEqual(self.client.get("/api/catalog/tv/1/seasons/-1").status_code, 422)

    def test_tmdb_id_mismatch_blocks_saving_and_posting(self) -> None:
        headers = self.auth_headers(self.user_a)
        with patch("app.library.tmdb_get", return_value={"id": 9999}):
            res = self.client.post("/api/me/saved-titles", headers=headers, json={"media_type": "movie", "tmdb_id": 603, "status": "watchlist"})
        self.assertEqual(res.status_code, 502)
        with patch("app.social.tmdb_get", return_value={"id": 9999, "title": "Wrong"}):
            res = self.client.post("/api/titles/movie/603/posts", headers=headers, json={"rating": 4.0})
        self.assertEqual(res.status_code, 502)

    def test_recommendations_require_auth_and_validate_limit(self) -> None:
        self.assertEqual(self.client.get("/api/me/recommendations").status_code, 401)
        headers = self.auth_headers(self.user_a)
        self.assertEqual(self.client.get("/api/me/recommendations?limit=0", headers=headers).status_code, 422)
        self.assertEqual(self.client.get("/api/me/recommendations?limit=21", headers=headers).status_code, 422)


class TestAccountDeletionSecurity(SecurityBaseTest):
    """Verify DELETE /api/me fails closed on insecure URLs, missing email, rate limits, or identity mismatch."""

    def test_rejects_non_local_http_supabase_url(self) -> None:
        app.dependency_overrides[get_settings] = lambda: Settings("http://example.supabase.co", TEST_SECRET, "", ())
        headers = self.auth_headers(self.user_a, issuer="http://example.supabase.co/auth/v1")
        env = {"SUPABASE_PUBLISHABLE_KEY": "pub", "SUPABASE_SECRET_KEY": "sec"}
        with patch.dict("os.environ", env), patch("app.account_deletion._opener.open") as opener:
            response = self.client.request("DELETE", "/api/me", headers=headers, json={"password": "pw"})
        self.assertEqual(response.status_code, 503)
        opener.assert_not_called()

    def test_rejects_missing_email_claim_and_handles_rate_limit(self) -> None:
        no_email_headers = self.auth_headers(self.user_a, omit=("email",))
        env = {"SUPABASE_PUBLISHABLE_KEY": "pub", "SUPABASE_SECRET_KEY": "sb_secret_123"}
        with patch.dict("os.environ", env), patch("app.account_deletion._opener.open") as opener:
            res = self.client.request("DELETE", "/api/me", headers=no_email_headers, json={"password": "pw"})
        self.assertEqual(res.status_code, 422)
        opener.assert_not_called()

        headers = self.auth_headers(self.user_a)
        err_429 = HTTPError(SUPABASE_URL, 429, "Too Many Requests", {}, None)
        with patch.dict("os.environ", env), patch("app.account_deletion._opener.open", side_effect=err_429):
            res = self.client.request("DELETE", "/api/me", headers=headers, json={"password": "pw"})
        self.assertEqual(res.status_code, 429)

    def test_never_deletes_when_reauth_returns_different_user_id(self) -> None:
        headers = self.auth_headers(self.user_a)
        env = {"SUPABASE_PUBLISHABLE_KEY": "pub", "SUPABASE_SECRET_KEY": "sb_secret_123"}
        with patch.dict("os.environ", env), patch(
            "app.account_deletion._opener.open",
            return_value=_FakeResponse({"user": {"id": self.user_b}}),
        ) as opener:
            response = self.client.request("DELETE", "/api/me", headers=headers, json={"password": "pw"})
        self.assertEqual(response.status_code, 401)
        self.assertEqual(opener.call_count, 1)

    def test_secret_key_header_formatting_legacy_vs_new(self) -> None:
        headers = self.auth_headers(self.user_a)
        for secret, expect_bearer in (("sb_secret_abc", False), ("eyJhbGciOiJIUzI1NiJ9.x.y", True)):
            with self.subTest(expect_bearer=expect_bearer):
                env = {"SUPABASE_PUBLISHABLE_KEY": "pub", "SUPABASE_SECRET_KEY": secret}
                responses = [_FakeResponse({"user": {"id": self.user_a}}), _FakeResponse({})]
                with patch.dict("os.environ", env), patch("app.account_deletion._opener.open", side_effect=responses) as opener:
                    res = self.client.request("DELETE", "/api/me", headers=headers, json={"password": "pw"})
                self.assertEqual(res.status_code, 204)
                admin_req = opener.call_args_list[1].args[0]
                self.assertEqual(admin_req.get_header("Apikey"), secret)
                self.assertEqual(admin_req.has_header("Authorization"), expect_bearer)


class TestHeadersAndErrorHygiene(SecurityBaseTest):
    """Verify CORS restrictions, Cache-Control headers, and zero secret leakage in errors."""

    def test_untrusted_cors_origin_not_reflected(self) -> None:
        response = self.client.options(
            "/api/me/saved-titles",
            headers={
                "Origin": "https://evil.example",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "authorization,content-type",
            },
        )
        self.assertNotEqual(response.headers.get("access-control-allow-origin"), "https://evil.example")
        self.assertNotEqual(response.headers.get("access-control-allow-origin"), "*")

    def test_private_cache_control_on_authenticated_routes(self) -> None:
        headers = self.auth_headers(self.user_a)
        for path in ("/api/me", "/api/me/preferences", "/api/me/saved-titles", "/api/me/profile", "/api/feed"):
            with self.subTest(path=path):
                res = self.client.get(path, headers=headers)
                self.assertEqual(res.status_code, 200)
                self.assertEqual(res.headers.get("cache-control"), "private, no-store")

    def test_error_responses_never_leak_secrets_or_tracebacks(self) -> None:
        secret_token = "super-secret-tmdb-token-do-not-leak"
        with patch.dict("os.environ", {"TMDB_READ_ACCESS_TOKEN": secret_token}), patch(
            "app.catalog.tmdb_get",
            side_effect=APIError(503, "catalog_unavailable", "Movie and TV data is unavailable. Please try again."),
        ):
            response = self.client.get("/api/catalog/search", params={"query": "Dune"})
        self.assertEqual(response.status_code, 503)
        body = response.json()
        self.assertEqual(set(body.keys()), {"error", "message"})
        self.assertNotIn(secret_token, response.text)
        self.assertNotIn("Traceback", response.text)


if __name__ == "__main__":
    unittest.main()
