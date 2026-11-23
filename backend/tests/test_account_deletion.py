import io
import json
import time
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from uuid import uuid4

import jwt
from fastapi.testclient import TestClient
from app.main import app
from app.settings import Settings, get_settings


class FakeResponse:
    def __init__(self, payload):
        self.payload = json.dumps(payload).encode()
    def __enter__(self):
        return io.BytesIO(self.payload)
    def __exit__(self, *args):
        pass


class AccountDeletionTest(unittest.TestCase):
    def setUp(self):
        self.id = str(uuid4())
        self.signing = "a-test-secret-that-is-longer-than-32-bytes"
        self.settings = Settings("https://example.supabase.co", self.signing, "", ())
        app.dependency_overrides[get_settings] = lambda: self.settings
        self.client = TestClient(app, client=(unittest.TestCase.id(self), 50000))
        token = jwt.encode({"sub": self.id, "email": "viewer@example.test", "aud": "authenticated",
                            "iss": self.settings.issuer, "exp": int(time.time()) + 600,
                            "role": "authenticated"}, self.signing, algorithm="HS256")
        self.headers = {"Authorization": "Bearer " + token}
        self.environment = {"SUPABASE_PUBLISHABLE_KEY": "public-test-key", "SUPABASE_SECRET_KEY": "secret-test-key"}

    def tearDown(self):
        app.dependency_overrides.clear()

    def call(self, password="correct"):
        return self.client.request("DELETE", "/api/me", headers=self.headers, json={"password": password})

    def test_success_targets_only_session_user(self):
        responses = [FakeResponse({"user": {"id": self.id}}), FakeResponse({})]
        with patch.dict("os.environ", self.environment), patch("app.account_deletion._opener.open", side_effect=responses) as call:
            self.assertEqual(self.call().status_code, 204)
        self.assertEqual(call.call_count, 2)
        self.assertEqual(call.call_args_list[1].args[0].full_url, self.settings.issuer + "/admin/users/" + self.id)

    def test_wrong_password_or_different_user_never_deletes(self):
        error = HTTPError("https://example.supabase.co", 400, "bad", {}, None)
        with patch.dict("os.environ", self.environment), patch("app.account_deletion._opener.open", side_effect=error) as call:
            self.assertEqual(self.call("wrong").status_code, 401)
            self.assertEqual(call.call_count, 1)
        with patch.dict("os.environ", self.environment), patch("app.account_deletion._opener.open", return_value=FakeResponse({"user": {"id": str(uuid4())}})) as call:
            self.assertEqual(self.call().status_code, 401)
            self.assertEqual(call.call_count, 1)

    def test_unavailable_delete_does_not_report_success(self):
        error = HTTPError("https://example.supabase.co", 500, "error", {}, None)
        with patch.dict("os.environ", self.environment), patch("app.account_deletion._opener.open", side_effect=[FakeResponse({"user": {"id": self.id}}), error]):
            self.assertEqual(self.call().status_code, 503)

    def test_missing_config_and_unauthenticated_fail_closed(self):
        with patch.dict("os.environ", {}, clear=True), patch("app.account_deletion._opener.open") as call:
            self.assertEqual(self.call().status_code, 503)
            call.assert_not_called()
        self.assertEqual(self.client.request("DELETE", "/api/me", json={"password": "x"}).status_code, 401)
