import json
import logging
import os
from functools import wraps

from django.http import JsonResponse
from django.utils import timezone

from .directory import get_user_directory
from .errors import ProfileNotFound, VersionConflict
from .models import Profile
from .repository import get_repository
from .services import ProfileService

logger = logging.getLogger(__name__)

MAX_NAME_LENGTH = 200
MAX_PHONE_LENGTH = 32


def health(request):
    if request.method != "GET":
        response = JsonResponse({"error": "method not allowed"}, status=405)
        response["Allow"] = "GET"
        return response

    response = JsonResponse(
        {
            "status": "ok",
            "service": os.getenv("SERVICE_NAME", "user-service"),
            "version": os.getenv("VERSION", "dev"),
            "environment": os.getenv("ENV", "dev"),
            "time": timezone.now().isoformat().replace("+00:00", "Z"),
        }
    )
    response["Cache-Control"] = "no-store"
    return response


def _json_errors(view):
    @wraps(view)
    def wrapped(request, *args, **kwargs):
        try:
            return view(request, *args, **kwargs)
        except Exception:
            logger.exception("unhandled user service error")
            return _error(
                "internal_error",
                "internal server error",
                500,
            )

    return wrapped


@_json_errors
def users_me(request):
    if request.method == "GET":
        return _get_or_create_me(request)
    if request.method == "PUT":
        return _update_me(request)

    return _method_not_allowed("GET, PUT")


@_json_errors
def user_detail(request, sub: str):
    if request.method != "GET":
        return _method_not_allowed("GET")

    repository = get_repository()
    if repository is None:
        return _error(
            "storage_unavailable",
            "user storage is not configured",
            503,
        )

    service = ProfileService(repository, get_user_directory())
    try:
        profile = service.get(sub)
    except ProfileNotFound:
        return _error("not_found", "user profile not found", 404)

    return JsonResponse(_profile_json(profile))


def _get_or_create_me(request):
    repository = get_repository()
    if repository is None:
        return _error(
            "storage_unavailable",
            "user storage is not configured",
            503,
        )

    service = ProfileService(repository, get_user_directory())
    profile = service.get_or_create(request.auth)
    return JsonResponse(_profile_json(profile))


def _update_me(request):
    payload, error = _parse_json(request)
    if error is not None:
        return error

    version = payload.get("version")
    if isinstance(version, bool) or not isinstance(version, int) or version <= 0:
        return _error("validation_error", "version must be a positive integer", 400)

    name = payload.get("name")
    phone = payload.get("phone")

    if name is None and phone is None:
        return _error(
            "validation_error",
            "at least one of name or phone must be provided",
            400,
        )

    if name is not None:
        if not isinstance(name, str):
            return _error("validation_error", "name must be a string", 400)
        name = name.strip()
        if len(name) > MAX_NAME_LENGTH:
            return _error(
                "validation_error",
                f"name must be at most {MAX_NAME_LENGTH} characters",
                400,
            )

    if phone is not None:
        if not isinstance(phone, str):
            return _error("validation_error", "phone must be a string", 400)
        phone = phone.strip()
        if len(phone) > MAX_PHONE_LENGTH:
            return _error(
                "validation_error",
                f"phone must be at most {MAX_PHONE_LENGTH} characters",
                400,
            )

    repository = get_repository()
    if repository is None:
        return _error(
            "storage_unavailable",
            "user storage is not configured",
            503,
        )

    service = ProfileService(repository, get_user_directory())
    try:
        profile = service.update(request.auth, name, phone, version)
    except ProfileNotFound:
        return _error("not_found", "user profile not found", 404)
    except VersionConflict:
        return _error(
            "version_conflict",
            "profile was modified; reload and retry",
            409,
        )

    return JsonResponse(_profile_json(profile))


def _parse_json(request):
    try:
        payload = json.loads(request.body or b"{}")
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None, _error("invalid_request", "invalid JSON body", 400)

    if not isinstance(payload, dict):
        return None, _error("invalid_request", "JSON body must be an object", 400)

    return payload, None


def _profile_json(profile: Profile) -> dict:
    return {
        "sub": profile.sub,
        "email": profile.email,
        "name": profile.name,
        "phone": profile.phone,
        "version": profile.version,
        "createdAt": profile.created_at,
        "updatedAt": profile.updated_at,
    }


def _method_not_allowed(allow: str):
    response = _error("method_not_allowed", "method not allowed", 405)
    response["Allow"] = allow
    return response


def _error(code: str, message: str, status: int):
    response = JsonResponse(
        {
            "error": {
                "code": code,
                "message": message,
            }
        },
        status=status,
    )
    return response
