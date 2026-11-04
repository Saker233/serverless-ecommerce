import json
from dataclasses import dataclass

AUTH_HEADERS = (
    "x-auth-sub",
    "x-auth-email",
    "x-auth-username",
    "x-auth-groups",
    "x-auth-token-use",
)


@dataclass(frozen=True)
class AuthContext:
    sub: str
    email: str
    username: str
    groups: tuple[str, ...]
    token_use: str

    @classmethod
    def from_request(cls, request) -> "AuthContext":
        return cls(
            sub=(request.headers.get("X-Auth-Sub") or "").strip(),
            email=(request.headers.get("X-Auth-Email") or "").strip(),
            username=(request.headers.get("X-Auth-Username") or "").strip(),
            groups=parse_groups(request.headers.get("X-Auth-Groups", "")),
            token_use=(request.headers.get("X-Auth-Token-Use") or "").strip(),
        )


def parse_groups(value: str) -> tuple[str, ...]:
    value = (value or "").strip()
    if not value:
        return ()

    if value.startswith("[") and value.endswith("]"):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            parsed = None

        if isinstance(parsed, list):
            return tuple(
                str(item).strip().strip('"')
                for item in parsed
                if str(item).strip()
            )

        return tuple(
            part.strip().strip('"').strip("'")
            for part in value[1:-1].split(",")
            if part.strip()
        )

    return tuple(
        part.strip().strip('"')
        for part in value.split(",")
        if part.strip()
    )


def inject_identity_headers(event: dict) -> dict:
    """Inject API Gateway JWT claims as trusted headers.

    The Lambda entrypoint calls this before Mangum. Client-supplied X-Auth-*
    headers are removed first so they cannot spoof identity.
    """
    headers = event.get("headers") or {}
    clean_headers = {
        key: value
        for key, value in headers.items()
        if not key.lower().startswith("x-auth-")
    }

    request_context = event.get("requestContext") or {}
    authorizer = request_context.get("authorizer") or {}
    jwt = authorizer.get("jwt") or {}
    claims = jwt.get("claims") or {}

    if not claims:
        event["headers"] = clean_headers
        return event

    sub = str(claims.get("sub", "")).strip()
    username = str(claims.get("username", "")).strip()
    email = str(claims.get("email", "")).strip()
    if not email and "@" in username:
        email = username

    groups = claims.get("cognito:groups", "")
    if isinstance(groups, (list, tuple)):
        groups = ",".join(str(group) for group in groups)

    clean_headers["X-Auth-Sub"] = sub
    clean_headers["X-Auth-Email"] = email
    clean_headers["X-Auth-Username"] = username
    clean_headers["X-Auth-Groups"] = str(groups or "")
    clean_headers["X-Auth-Token-Use"] = str(claims.get("token_use", "")).strip()

    event["headers"] = clean_headers
    return event
