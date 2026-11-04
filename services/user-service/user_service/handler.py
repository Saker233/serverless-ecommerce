from mangum import Mangum

from .asgi import application

# Lambda handler: user_service.handler.handler
handler = Mangum(application, lifespan="off")
