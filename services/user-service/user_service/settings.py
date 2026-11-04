import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent

# Local development only. Lambda supplies environment variables directly.
load_dotenv(BASE_DIR / "app.env", override=False)

SECRET_KEY = os.getenv("DJANGO_SECRET_KEY", "dev-only-insecure-secret-key")
DEBUG = os.getenv("DJANGO_DEBUG", "false").lower() == "true"
ALLOWED_HOSTS = [
    host.strip()
    for host in os.getenv("ALLOWED_HOSTS", "*").split(",")
    if host.strip()
]

ENV = os.getenv("ENV", "dev")
SERVICE_NAME = os.getenv("SERVICE_NAME", "user-service")
VERSION = os.getenv("VERSION", "dev")
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")
USERS_TABLE = os.getenv("USERS_TABLE", "")

INSTALLED_APPS = []
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.middleware.common.CommonMiddleware",
]

ROOT_URLCONF = "user_service.urls"
TEMPLATES = []
WSGI_APPLICATION = "user_service.wsgi.application"
ASGI_APPLICATION = "user_service.asgi.application"

# DynamoDB is accessed through a repository layer, not the Django ORM.
DATABASES = {}

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = False
USE_TZ = True
APPEND_SLASH = False

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
        }
    },
    "root": {
        "handlers": ["console"],
        "level": LOG_LEVEL,
    },
}
