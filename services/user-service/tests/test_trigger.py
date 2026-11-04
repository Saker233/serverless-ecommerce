from unittest.mock import patch

from django.test import SimpleTestCase

from user_service.errors import ProfileAlreadyExists
from user_service.trigger import build_profile, handler


def cognito_event(sub="user-1", email="user@example.com", name="Test User"):
    return {
        "version": "1",
        "triggerSource": "PostConfirmation_ConfirmSignUp",
        "region": "eu-west-1",
        "userPoolId": "eu-west-1_TEST",
        "userName": "internal-uuid",
        "request": {
            "userAttributes": {
                "sub": sub,
                "email": email,
                "email_verified": "true",
                "name": name,
            }
        },
        "response": {},
    }


class FakeRepository:
    def __init__(self, error=None):
        self.error = error
        self.created = []

    def create(self, profile):
        if self.error is not None:
            raise self.error
        self.created.append(profile)
        return profile


class BuildProfileTests(SimpleTestCase):
    def test_builds_profile_from_cognito_attributes(self):
        profile = build_profile(cognito_event())

        self.assertEqual(profile.sub, "user-1")
        self.assertEqual(profile.email, "user@example.com")
        self.assertEqual(profile.name, "Test User")
        self.assertEqual(profile.version, 1)
        self.assertTrue(profile.created_at)
        self.assertTrue(profile.updated_at)

    def test_accepts_list_style_attributes(self):
        event = cognito_event()
        event["request"]["userAttributes"] = [
            {"Name": name, "Value": value}
            for name, value in event["request"]["userAttributes"].items()
        ]

        profile = build_profile(event)

        self.assertEqual(profile.sub, "user-1")
        self.assertEqual(profile.email, "user@example.com")

    def test_requires_sub(self):
        event = cognito_event()
        event["request"]["userAttributes"].pop("sub")

        with self.assertRaises(ValueError):
            build_profile(event)


class TriggerHandlerTests(SimpleTestCase):
    def test_creates_profile(self):
        repository = FakeRepository()

        with patch("user_service.trigger._repository", return_value=repository):
            event = cognito_event()
            result = handler(event, None)

        self.assertIs(result, event)
        self.assertEqual(len(repository.created), 1)
        self.assertEqual(repository.created[0].sub, "user-1")

    def test_duplicate_profile_is_idempotent(self):
        repository = FakeRepository(error=ProfileAlreadyExists())

        with patch("user_service.trigger._repository", return_value=repository):
            result = handler(cognito_event(), None)

        self.assertEqual(result["triggerSource"], "PostConfirmation_ConfirmSignUp")

    def test_repository_failure_does_not_break_signup(self):
        repository = FakeRepository(error=RuntimeError("boom"))

        with patch("user_service.trigger._repository", return_value=repository):
            result = handler(cognito_event(), None)

        self.assertEqual(result["triggerSource"], "PostConfirmation_ConfirmSignUp")
