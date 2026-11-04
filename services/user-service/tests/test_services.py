from django.test import SimpleTestCase

from user_service.auth import AuthContext
from user_service.errors import ProfileAlreadyExists, ProfileNotFound, VersionConflict
from user_service.models import utc_now
from user_service.services import ProfileService


class FakeRepository:
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


class FakeDirectory:
    def __init__(self, email):
        self.email = email

    def email_for(self, username):
        return self.email


class ProfileServiceTests(SimpleTestCase):
    def test_uses_directory_when_access_token_has_no_email(self):
        repository = FakeRepository()
        service = ProfileService(
            repository,
            user_directory=FakeDirectory("resolved@example.com"),
        )
        auth = AuthContext(
            sub="user-1",
            email="",
            username="internal-uuid",
            groups=(),
            token_use="access",
        )

        profile = service.get_or_create(auth)

        self.assertEqual(profile.email, "resolved@example.com")

    def test_uses_claim_email_without_directory_lookup(self):
        repository = FakeRepository()
        service = ProfileService(
            repository,
            user_directory=FakeDirectory("wrong@example.com"),
        )
        auth = AuthContext(
            sub="user-1",
            email="claim@example.com",
            username="user@example.com",
            groups=(),
            token_use="access",
        )

        profile = service.get_or_create(auth)

        self.assertEqual(profile.email, "claim@example.com")
