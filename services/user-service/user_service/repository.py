import logging
import os
from functools import lru_cache
from typing import Protocol

import boto3
from botocore.exceptions import ClientError
from django.conf import settings

from .errors import ProfileAlreadyExists, VersionConflict
from .models import Profile, utc_now

logger = logging.getLogger(__name__)


class ProfileRepository(Protocol):
    def get(self, sub: str) -> Profile | None:
        ...

    def create(self, profile: Profile) -> Profile:
        ...

    def update(
        self,
        sub: str,
        name: str | None,
        phone: str | None,
        expected_version: int,
    ) -> Profile:
        ...


class DynamoProfileRepository:
    def __init__(self, client, table_name: str):
        self._client = client
        self._table_name = table_name

    def get(self, sub: str) -> Profile | None:
        response = self._client.get_item(
            TableName=self._table_name,
            Key={
                "PK": {"S": f"USER#{sub}"},
                "SK": {"S": "PROFILE"},
            },
            ConsistentRead=True,
        )

        item = response.get("Item")
        return Profile.from_item(item) if item else None

    def create(self, profile: Profile) -> Profile:
        try:
            self._client.put_item(
                TableName=self._table_name,
                Item=profile.to_item(),
                ConditionExpression="attribute_not_exists(PK)",
            )
        except ClientError as exc:
            if _is_conditional_failure(exc):
                raise ProfileAlreadyExists from exc
            raise

        return profile

    def update(
        self,
        sub: str,
        name: str | None,
        phone: str | None,
        expected_version: int,
    ) -> Profile:
        names = {
            "#version": "version",
            "#updatedAt": "updatedAt",
        }
        values = {
            ":expectedVersion": {"N": str(expected_version)},
            ":one": {"N": "1"},
            ":updatedAt": {"S": utc_now()},
        }
        sets = [
            "#updatedAt = :updatedAt",
            "#version = #version + :one",
        ]

        if name is not None:
            names["#name"] = "name"
            values[":name"] = {"S": name}
            sets.append("#name = :name")

        if phone is not None:
            names["#phone"] = "phone"
            values[":phone"] = {"S": phone}
            sets.append("#phone = :phone")

        try:
            response = self._client.update_item(
                TableName=self._table_name,
                Key={
                    "PK": {"S": f"USER#{sub}"},
                    "SK": {"S": "PROFILE"},
                },
                UpdateExpression="SET " + ", ".join(sets),
                ConditionExpression=(
                    "attribute_exists(PK) AND #version = :expectedVersion"
                ),
                ExpressionAttributeNames=names,
                ExpressionAttributeValues=values,
                ReturnValues="ALL_NEW",
            )
        except ClientError as exc:
            if _is_conditional_failure(exc):
                raise VersionConflict from exc
            raise

        return Profile.from_item(response["Attributes"])


def _is_conditional_failure(exc: ClientError) -> bool:
    return exc.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException"


@lru_cache(maxsize=1)
def get_repository() -> ProfileRepository | None:
    table_name = (settings.USERS_TABLE or "").strip()
    if not table_name:
        return None

    try:
        client = boto3.client(
            "dynamodb",
            region_name=os.getenv("AWS_REGION") or None,
        )
    except Exception:
        logger.exception("failed to create DynamoDB client")
        return None

    return DynamoProfileRepository(client, table_name)
