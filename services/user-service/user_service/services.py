import logging

from .auth import AuthContext
from .directory import CognitoUserDirectory
from .errors import ProfileAlreadyExists, ProfileNotFound
from .models import Profile, utc_now
from .repository import ProfileRepository

logger = logging.getLogger(__name__)


class ProfileService:
    def __init__(
        self,
        repository: ProfileRepository,
        user_directory: CognitoUserDirectory | None = None,
    ):
        self._repository = repository
        self._user_directory = user_directory

    def get_or_create(self, auth: AuthContext) -> Profile:
        profile = self._repository.get(auth.sub)
        if profile is not None:
            return profile

        email = auth.email
        if not email and auth.username and self._user_directory is not None:
            try:
                email = self._user_directory.email_for(auth.username)
            except Exception:
                logger.warning(
                    "could not resolve email from Cognito",
                    exc_info=True,
                )

        now = utc_now()
        profile = Profile(
            sub=auth.sub,
            email=email,
            name="",
            phone="",
            version=1,
            created_at=now,
            updated_at=now,
        )

        try:
            return self._repository.create(profile)
        except ProfileAlreadyExists:
            existing = self._repository.get(auth.sub)
            if existing is None:
                raise
            return existing

    def get(self, sub: str) -> Profile:
        profile = self._repository.get(sub)
        if profile is None:
            raise ProfileNotFound
        return profile

    def update(
        self,
        auth: AuthContext,
        name: str | None,
        phone: str | None,
        version: int,
    ) -> Profile:
        if self._repository.get(auth.sub) is None:
            raise ProfileNotFound

        return self._repository.update(auth.sub, name, phone, version)
