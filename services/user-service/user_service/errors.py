class ProfileNotFound(Exception):
    """The requested user profile does not exist."""


class ProfileAlreadyExists(Exception):
    """A concurrent request created the profile first."""


class VersionConflict(Exception):
    """The caller supplied a stale profile version."""
