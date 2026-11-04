# User Service

Django + Mangum profile service. Cognito owns identity; this service owns user profiles.

## Endpoints

| Method | Path | Auth |
|---|---|---|
| `GET` | `/health` | Public |
| `GET` | `/users/me` | Cognito access token |
| `PUT` | `/users/me` | Cognito access token |
| `GET` | `/users/{sub}` | Cognito access token |

`GET /users/me` lazily creates the profile on first call. `PUT /users/me` requires the current `version` and updates `name` and `phone`.

## Cognito signup trigger

A Cognito `PostConfirmation` Lambda creates the profile immediately after signup.

```text
Handler: user_service.trigger.handler
Function: serverless-ecommerce-dev-user-trigger
Runtime: python3.12
```

The trigger creates `USER#<sub> / PROFILE` with the email and name from the Cognito event. It is idempotent: a duplicate trigger is ignored. If the trigger fails, signup continues and `GET /users/me` lazily creates the profile later.

The trigger needs `dynamodb:PutItem` on the users table and `USERS_TABLE` in its environment.

## Storage

Profiles are stored in DynamoDB through `user_service/repository.py`.

```text
PK = USER#<cognito-sub>
SK = PROFILE
```

Django's ORM is not used.

## Authentication

API Gateway validates the Cognito JWT. The Lambda entrypoint in `user_service/auth.py` extracts `requestContext.authorizer.jwt.claims`, strips client-supplied `X-Auth-*` headers, and injects trusted identity headers. Django middleware requires `token_use == "access"` for `/users` routes.

If the access token has no email claim, the service resolves the email through Cognito `AdminGetUser` using `COGNITO_USER_POOL_ID`.

## Local development

```bash
cd services/user-service
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example app.env
python manage.py test
python manage.py runserver 0.0.0.0:8001
```

Health:

```bash
curl -i http://localhost:8001/health
```

Local `/users` calls need trusted headers because API Gateway is not in front of the local server:

```bash
curl -i http://localhost:8001/users/me \
  -H 'X-Auth-Sub: local-user' \
  -H 'X-Auth-Email: local@example.com' \
  -H 'X-Auth-Token-Use: access'
```

## Configuration

| Variable | Purpose |
|---|---|
| `ENV` | Environment name |
| `SERVICE_NAME` | Service name |
| `VERSION` | Version |
| `LOG_LEVEL` | Log level |
| `DJANGO_DEBUG` | Local debug flag |
| `DJANGO_SECRET_KEY` | Django secret |
| `ALLOWED_HOSTS` | Comma-separated allowed hosts |
| `AWS_PROFILE` | Local AWS profile |
| `AWS_REGION` | AWS region |
| `USERS_TABLE` | DynamoDB table name |
| `COGNITO_USER_POOL_ID` | Cognito user pool for email lookup |

`app.env` is gitignored. `.env.example` is the committed template.

## Lambda

Handler:

```text
user_service.handler.handler
```

Runtime: Python 3.12 or newer.

Package:

```bash
pip install -r requirements.txt -t build
cp -R user_service manage.py build/
cd build
zip -r ../user-service.zip .
```

Do not package `app.env`.
