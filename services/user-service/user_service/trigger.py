import logging
import os

import boto3

from .errors import ProfileAlreadyExists
from .models import Profile, utc_now
from .repository import DynamoProfileRepository

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


def build_profile(event: dict) -> Profile:
    request = event.get("request") or {}
    raw_attributes = request.get("userAttributes") or {}

    if isinstance(raw_attributes, dict):
        attributes = {
            str(name): str(value or "")
            for name, value in raw_attributes.items()
        }
    else:
        attributes = {
            attribute.get("Name"): attribute.get("Value", "")
            for attribute in raw_attributes
            if isinstance(attribute, dict) and attribute.get("Name")
        }

    sub = (attributes.get("sub") or "").strip()
    if not sub:
        raise ValueError("Cognito event is missing sub")

    now = utc_now()
    return Profile(
        sub=sub,
        email=(attributes.get("email") or "").strip(),
        name=(attributes.get("name") or "").strip(),
        phone=(attributes.get("phone_number") or "").strip(),
        version=1,
        created_at=now,
        updated_at=now,
    )


def handler(event, context=None):
    """Cognito PostConfirmation trigger.

    Profile creation is best-effort. If it fails, lazy provisioning through
    GET /users/me remains the fallback.
    """
    try:
        profile = build_profile(event)
        repository = _repository()
        if repository is None:
            raise RuntimeError("USERS_TABLE is not configured")

        try:
            repository.create(profile)
            logger.info("created user profile sub=%s", profile.sub)
        except ProfileAlreadyExists:
            logger.info("user profile already exists sub=%s", profile.sub)
    except Exception:
        logger.exception("failed to create user profile from Cognito trigger")

    return event


def _repository() -> DynamoProfileRepository | None:
    table_name = (os.getenv("USERS_TABLE") or "").strip()
    if not table_name:
        return None

    client = boto3.client(
        "dynamodb",
        region_name=os.getenv("AWS_REGION") or None,
    )
    return DynamoProfileRepository(client, table_name)
