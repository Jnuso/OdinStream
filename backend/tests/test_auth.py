import time
import unittest
import uuid
from unittest.mock import patch

import jwt
from fastapi.testclient import TestClient

from app.main import app
from app.settings import Settings, get_settings


class AuthenticationTest(unittest.TestCase):
    def setUp(self):
        self.secret = "a-test-secret-that-is-longer-than-32-bytes"
        self.settings = Settings("https://example.supabase.co", self.secret, "", ())
        app.dependency_overrides[get_settings] = lambda: self.settings
        self.client = TestClient(app, client=(self.id(), 50000))
        self.user_id = str(uuid.uuid4())

    def tearDown(self):
        app.dependency_overrides.clear()

    def token(self, **overrides):
        claims = {"sub": self.user_id, "aud": "authenticated", "iss": self.settings.issuer,
                  "exp": int(time.time()) + 600, "role": "authenticated"}
        claims.update(overrides)
        return jwt.encode(claims, self.secret, algorithm="HS256")

    def test_valid_identity_and_invalid_tokens(self):
        response = self.client.get("/api/me", headers={"Authorization": "Bearer " + self.token()})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["id"], self.user_id)
        for token in [self.token(iss="https://wrong.example"), self.token(aud="other"),
                      self.token(exp=int(time.time()) - 1), self.token(role="anon")]:
            with self.subTest(token=token):
                self.assertEqual(self.client.get("/api/me", headers={"Authorization": "Bearer " + token}).status_code, 401)
        self.assertEqual(self.client.get("/api/me").status_code, 401)

    def test_jwks_errors_return_controlled_responses(self):
        token = jwt.encode({"sub": self.user_id}, self.secret, algorithm="HS256")
        with patch("app.auth.jwt.get_unverified_header", return_value={"alg": "RS256"}), \
             patch("app.auth._decode_asymmetric", side_effect=jwt.PyJWKClientError("unknown kid")):
            self.assertEqual(self.client.get("/api/me", headers={"Authorization": "Bearer " + token}).status_code, 401)
        with patch("app.auth.jwt.get_unverified_header", return_value={"alg": "RS256"}), \
             patch("app.auth._decode_asymmetric", side_effect=jwt.PyJWKClientConnectionError("offline")):
            self.assertEqual(self.client.get("/api/me", headers={"Authorization": "Bearer " + token}).status_code, 503)

    def test_missing_issuer_configuration_fails_closed(self):
        token = self.token()
        app.dependency_overrides[get_settings] = lambda: Settings("", self.secret, "", ())
        self.assertEqual(self.client.get("/api/me", headers={"Authorization": "Bearer " + token}).status_code, 401)


if __name__ == "__main__":
    unittest.main()
