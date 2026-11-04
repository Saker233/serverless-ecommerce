import logging
import os
from functools import lru_cache

import boto3
from django.conf import settings

logger = logging.getLogger(__name__)


class CognitoUserDirectory:
    def __init__(self, client, user_pool_id: str):
        self._client = client
        self._user_pool_id = user_pool_id

    def email_for(self, username: str) -> str:
        response = self._client.admin_get_user(
            UserPoolId=self._user_pool_id,
            Username=username,
        )

        for attribute in response.get("UserAttributes", []):
            if attribute.get("Name") == "email":
                return (attribute.get("Value") or "").strip()

        return ""


@lru_cache(maxsize=1)
def get_user_directory() -> CognitoUserDirectory | None:
    user_pool_id = (settings.COGNITO_USER_POOL_ID or "").strip()
    if not user_pool_id:
        return None

    try:
        client = boto3.client(
            "cognito-idp",
            region_name=os.getenv("AWS_REGION") or None,
        )
    except Exception:
        logger.exception("failed to create Cognito client")
        return None

    return CognitoUserDirectory(client, user_pool_id)
