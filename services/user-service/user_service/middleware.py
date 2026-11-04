from django.http import JsonResponse

from .auth import AuthContext


def _unauthorized():
    response = JsonResponse(
        {
            "error": {
                "code": "unauthorized",
                "message": "authentication required",
            }
        },
        status=401,
    )
    response["WWW-Authenticate"] = "Bearer"
    return response


class AuthenticationMiddleware:
    """Require an access token for /users endpoints.

    API Gateway validates the token. This middleware only checks that the
    trusted identity headers were injected by the Lambda entrypoint.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        auth = AuthContext.from_request(request)
        request.auth = auth

        if request.path.startswith("/users"):
            if not auth.sub or auth.token_use != "access":
                return _unauthorized()

        return self.get_response(request)
