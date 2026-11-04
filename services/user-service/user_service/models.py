from dataclasses import dataclass
from datetime import datetime, timezone


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _string(item: dict, key: str, default: str = "") -> str:
    value = item.get(key)
    if not isinstance(value, dict):
        return default

    return str(value.get("S", default))


@dataclass
class Profile:
    sub: str
    email: str
    name: str
    phone: str
    version: int
    created_at: str
    updated_at: str

    def to_item(self) -> dict:
        return {
            "PK": {"S": f"USER#{self.sub}"},
            "SK": {"S": "PROFILE"},
            "sub": {"S": self.sub},
            "email": {"S": self.email},
            "name": {"S": self.name},
            "phone": {"S": self.phone},
            "version": {"N": str(self.version)},
            "createdAt": {"S": self.created_at},
            "updatedAt": {"S": self.updated_at},
        }

    @classmethod
    def from_item(cls, item: dict) -> "Profile":
        version = item.get("version", {})
        if not isinstance(version, dict):
            version_value = 1
        else:
            version_value = int(version.get("N", "1"))

        return cls(
            sub=_string(item, "sub"),
            email=_string(item, "email"),
            name=_string(item, "name"),
            phone=_string(item, "phone"),
            version=version_value,
            created_at=_string(item, "createdAt"),
            updated_at=_string(item, "updatedAt"),
        )
