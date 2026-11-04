import os

from django.http import JsonResponse
from django.utils import timezone


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
