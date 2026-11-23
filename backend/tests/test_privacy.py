import time
import unittest
from unittest.mock import patch
from uuid import uuid4

import jwt
from fastapi.testclient import TestClient
from app.main import app
from app.settings import Settings, get_settings
from app.social import PostgresSocialStore, social_store
from app.errors import APIError


class PrivacyStore:
    def __init__(self, owner, viewer):
        self.owner, self.viewer = owner, viewer
        self.visibility = "private"
        self.requests_by_user = set()
        self.followers = set()

    def profile(self, viewer, target):
        if target != self.owner:
            raise APIError(404, "profile_not_found", "Profile not found.")
        return {"id": target, "visibility": self.visibility, "viewer_follows": viewer in self.followers}

    def posts_by_author(self, viewer, target, limit, offset):
        return [{"id": "post"}]

    def set_visibility(self, user, visibility):
        self.visibility = visibility
        return self.profile(user, user)

    def follow(self, user, target):
        self.profile(user, target)
        self.requests_by_user.add(user)

    def unfollow(self, user, target):
        self.requests_by_user.discard(user)
        self.followers.discard(user)

    def requests(self, user, limit, offset):
        rows = [{"user_id": requester} for requester in self.requests_by_user] if user == self.owner else []
        return rows[offset:offset + limit]

    def resolve_request(self, user, requester, approve):
        if user != self.owner or requester not in self.requests_by_user:
            raise APIError(404, "request_not_found", "Follow request not found.")
        self.requests_by_user.remove(requester)
        if approve:
            self.followers.add(requester)

    def remove_follower(self, user, follower):
        if user == self.owner:
            self.followers.discard(follower)


class PrivacyRoutesTest(unittest.TestCase):
    def setUp(self):
        self.owner, self.viewer, self.other = (str(uuid4()) for _ in range(3))
        self.secret = "test-secret-which-is-at-least-32-bytes"
        self.settings = Settings("https://example.supabase.co", self.secret, "", ())
        self.store = PrivacyStore(self.owner, self.viewer)
        app.dependency_overrides[get_settings] = lambda: self.settings
        app.dependency_overrides[social_store] = lambda: self.store
        self.client = TestClient(app, client=(self.id(), 50000))

    def tearDown(self):
        app.dependency_overrides.clear()

    def headers(self, user):
        token = jwt.encode({"sub": user, "aud": "authenticated", "iss": self.settings.issuer,
                            "exp": int(time.time()) + 600, "role": "authenticated"}, self.secret, algorithm="HS256")
        return {"Authorization": "Bearer " + token}

    def test_connections_require_auth_and_respect_target_access(self):
        store = PostgresSocialStore("")
        app.dependency_overrides[social_store] = lambda: store
        path = f"/api/profiles/{self.owner}/connections/followers?limit=1"
        self.assertEqual(self.client.get(path).status_code, 401)
        with patch.object(store, "_run") as run:
            run.return_value = [{"allowed": False, "user_id": None}]
            self.assertEqual(self.client.get(path, headers=self.headers(self.viewer)).status_code, 403)
            run.return_value = [
                {"allowed": True, "user_id": self.viewer, "display_name": "Viewer", "handle": "viewer"},
                {"allowed": True, "user_id": self.other, "display_name": "Other", "handle": "other"},
            ]
            response = self.client.get(path, headers=self.headers(self.owner))
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json(), {
                "items": [{"user_id": self.viewer, "display_name": "Viewer", "handle": "viewer"}],
                "next_offset": 1,
            })
            self.assertEqual(run.call_args.args[2], (self.owner, self.owner, 2, 0, self.owner))

    def test_request_approval_and_removal_gate_profile_posts(self):
        path = f"/api/profiles/{self.owner}/posts"
        self.assertEqual(self.client.get(path, headers=self.headers(self.viewer)).status_code, 403)
        self.assertEqual(self.client.put(f"/api/profiles/{self.owner}/follow", headers=self.headers(self.viewer)).status_code, 204)
        self.assertEqual(self.client.get(path, headers=self.headers(self.viewer)).status_code, 403)
        request = f"/api/me/follow-requests/{self.viewer}/approve"
        self.assertEqual(self.client.post(request, headers=self.headers(self.other)).status_code, 404)
        self.assertEqual(self.client.get("/api/me/follow-requests", headers=self.headers(self.owner)).json()["items"][0]["user_id"], self.viewer)
        self.assertEqual(self.client.post(request, headers=self.headers(self.owner)).status_code, 204)
        self.assertEqual(self.client.get(path, headers=self.headers(self.viewer)).status_code, 200)
        self.assertEqual(self.client.delete(f"/api/me/followers/{self.viewer}", headers=self.headers(self.owner)).status_code, 204)
        self.assertEqual(self.client.get(path, headers=self.headers(self.viewer)).status_code, 403)

    def test_visibility_validation_and_decline(self):
        url = "/api/me/profile/visibility"
        self.assertEqual(self.client.patch(url, json={"visibility": "friends"}, headers=self.headers(self.owner)).status_code, 422)
        self.assertEqual(self.client.put(f"/api/profiles/{self.owner}/follow", headers=self.headers(self.viewer)).status_code, 204)
        self.assertEqual(self.client.post(f"/api/me/follow-requests/{self.viewer}/decline", headers=self.headers(self.owner)).status_code, 204)
        self.assertEqual(self.client.get("/api/me/follow-requests", headers=self.headers(self.owner)).json()["items"], [])
        self.assertEqual(self.client.patch(url, json={"visibility": "public"}, headers=self.headers(self.owner)).status_code, 200)


if __name__ == "__main__":
    unittest.main()
