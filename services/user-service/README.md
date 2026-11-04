# User Service

Django + Mangum base for the User Service. Cognito owns identity; this service will own user profiles.

Current scope:

- Django project scaffold
- `GET /health`
- Mangum Lambda handler
- Local `app.env` loading

Profile CRUD and DynamoDB integration are not implemented yet.

## Local development

```bash
cd services/user-service
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example app.env
python manage.py runserver 0.0.0.0:8001
```

Test:

```bash
curl -i http://localhost:8001/health
python manage.py test
```

## Lambda handler

```text
user_service.handler.handler
```

Build a deployment package later with:

```bash
pip install -r requirements.txt -t build
cp -R user_service manage.py build/
cd build
zip -r ../user-service.zip .
```

The Lambda runtime should be Python 3.12 or newer.
