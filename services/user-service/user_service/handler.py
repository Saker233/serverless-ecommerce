from mangum import Mangum

from .asgi import application
from .auth import inject_identity_headers

_mangum_handler = Mangum(application, lifespan="off")


def handler(event, context):
    inject_identity_headers(event)
    return _mangum_handler(event, context)
