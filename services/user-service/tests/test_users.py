import json
from unittest.mock import patch

from django.test import SimpleTestCase

from user_service.errors import ProfileAlreadyExists, ProfileNotFound, VersionConflict
from user_service.models import utc_now


class FakeProfileRepository:
    def __init__(self):
        self.profiles = {}

    def get(self, sub):
        return self.profiles.get(sub)

    def create(self, profile):
        if profile.sub in self.profiles:
            raise ProfileAlreadyExists
        self.profiles[profile.sub] = profile
        return profile

    def update(self, sub, name, phone, expected_version):
        profile = self.profiles.get(sub)
        if profile is None:
            raise ProfileNotFound
        if profile.version != expected_version:
            raise VersionConflict

        if name is not None:
            profile.name = name
        if phone is not None:
            profile.phone = phone

        profile.version += 1
        profile.updated_at = utc_now()
        return profile


def auth_headers(sub="user-1", email="user@example.com", token_use="access"):
    return {
        "HTTP_X_AUTH_SUB": sub,
        "HTTP_X_AUTH_EMAIL": email,
        "HTTP_X_AUTH_TOKEN_USE": token_use,
    }


class UserEndpointTests(SimpleTestCase):
    def setUp(self):
        self.repository = FakeProfileRepository()
        self.directory_patcher = patch(
            "user_service.views.get_user_directory",
            return_value=None,
        )
        self.directory_patcher.start()
        self.addCleanup(self.directory_patcher.stop)

    def test_get_me_creates_profile_lazily(self):
        with patch(
            "user_service.views.get_repository",
            return_value=self.repository,
        ):
            response = self.client.get("/users/me", **auth_headers())

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["sub"], "user-1")
        self.assertEqual(body["email"], "user@example.com")
        self.assertEqual(body["name"], "")
        self.assertEqual(body["version"], 1)
        self.assertIn("createdAt", body)
        self.assertEqual(len(self.repository.profiles), 1)

    def test_get_me_requires_authentication(self):
        response = self.client.get("/users/me")

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response["WWW-Authenticate"], "Bearer")

    def test_get_me_rejects_non_access_token(self):
        with patch(
            "user_service.views.get_repository",
            return_value=self.repository,
        ):
            response = self.client.get(
                "/users/me",
                **auth_headers(token_use="id"),
            )

        self.assertEqual(response.status_code, 401)

    def test_update_me(self):
        with patch(
            "user_service.views.get_repository",
            return_value=self.repository,
        ):
            self.client.get("/users/me", **auth_headers())
            response = self.client.put(
                "/users/me",
                data=json.dumps(
                    {
                        "name": "Test User",
                        "phone": "+15555550123",
                        "version": 1,
                    }
                ),
                content_type="application/json",
                **auth_headers(),
            )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["name"], "Test User")
        self.assertEqual(body["phone"], "+15555550123")
        self.assertEqual(body["version"], 2)

    def test_update_me_rejects_stale_version(self):
        with patch(
            "user_service.views.get_repository",
            return_value=self.repository,
        ):
            self.client.get("/users/me", **auth_headers())
            response = self.client.put(
                "/users/me",
                data=json.dumps({"name": "Test User", "version": 99}),
                content_type="application/json",
                **auth_headers(),
            )

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["error"]["code"], "version_conflict")

    def test_update_me_requires_a_field(self):
        with patch(
            "user_service.views.get_repository",
            return_value=self.repository,
        ):
            self.client.get("/users/me", **auth_headers())
            response = self.client.put(
                "/users/me",
                data=json.dumps({"version": 1}),
                content_type="application/json",
                **auth_headers(),
            )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"]["code"], "validation_error")

    def test_get_other_profile(self):
        with patch(
            "user_service.views.get_repository",
            return_value=self.repository,
        ):
            self.client.get("/users/me", **auth_headers())
            response = self.client.get(
                "/users/user-1",
                **auth_headers(sub="user-2"),
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["sub"], "user-1")

    def test_get_missing_profile(self):
        with patch(
            "user_service.views.get_repository",
            return_value=self.repository,
        ):
            response = self.client.get(
                "/users/missing",
                **auth_headers(),
            )

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["error"]["code"], "not_found")

    def test_repository_failure_returns_json_500(self):
        class BrokenRepository:
            def get(self, sub):
                raise RuntimeError("boom")

        with patch(
            "user_service.views.get_repository",
            return_value=BrokenRepository(),
        ):
            response = self.client.get("/users/me", **auth_headers())

        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.json()["error"]["code"], "internal_error")
