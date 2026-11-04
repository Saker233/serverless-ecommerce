# Serverless E-commerce Platform

A polyglot, event-driven e-commerce backend built on AWS serverless services.

The project explores how to design, deploy, and operate independently deployable microservices using different runtimes while keeping infrastructure, security, and observability production-oriented.

> **Status:** early development. Product Service CRUD + DynamoDB + CI/CD, the Django User Service profile API + Cognito signup trigger + CI/CD, and the TypeScript Order Service CRUD + DynamoDB + CI/CD are deployed. Cognito authenticates all three APIs. Authorization is intentionally deferred except for order ownership checks.

## Goals

- Build independently deployable services in Go, Python, and TypeScript.
- Give every service its own Lambda function, API, data store, and deployment pipeline.
- Use synchronous HTTP only where an immediate response is required.
- Use EventBridge and SQS for asynchronous, eventually consistent workflows.
- Apply least-privilege IAM, OIDC-based deployments, and structured observability.
- Model DynamoDB around access patterns rather than relational tables.

## Architecture

### Current

```text
Client
  │  Cognito access token
  ▼
Amazon Cognito
  │
  ├──► Product API Gateway HTTP API
  │       public: GET /health, GET /products, GET /products/{id}
  │       JWT:    POST/PUT/DELETE /products
  │       └──► Product Lambda (Go/Gin) ──► DynamoDB: products
  │
  ├──► User API Gateway HTTP API
  │       public: GET /health
  │       JWT:    GET/PUT /users/me, GET /users/{sub}
  │       └──► User Lambda (Django/Mangum) ──► DynamoDB: users
  │
  ├──► Order API Gateway HTTP API
  │       public: GET /health
  │       JWT:    POST /orders, GET /orders, GET /orders/{id}
  │       └──► Order Lambda (TypeScript/Express) ──► DynamoDB: orders
  │
  └──► PostConfirmation trigger ──► User trigger Lambda ──► DynamoDB: users
```

### Target

```text
Client
  │
  ▼
Amazon Cognito ──► API Gateway HTTP APIs (one per service)
                        │
        ┌───────────────┼────────────────┐
        ▼               ▼                ▼
   User Lambda     Product Lambda    Order Lambda
   (Django)        (Go/Gin)          (TypeScript)
        │               │                │
        ▼               ▼                ▼
     users DB       products DB       orders DB
                                    (DynamoDB)

Order events
    │
    ▼
Amazon EventBridge
    │
    ├──► SQS ──► Inventory Lambda ──► inventory DB
    └──► SQS ──► Notification Lambda ──► email
```

Services never read or write another service's DynamoDB table. Cross-service reads use HTTP; side effects use events.

## Services

| Service | Runtime | Responsibility | Status |
|---|---|---|---|
| Product | Go + Gin | Product catalog, pricing, categories | CRUD + DynamoDB + CI/CD; Cognito-authenticated writes |
| User | Python + Django | User profiles | Profile CRUD + DynamoDB + signup trigger + CI/CD |
| Order | TypeScript + Express | Order lifecycle | CRUD + DynamoDB + idempotency + CI/CD |
| Inventory | TBD | Stock reservations and movements | Planned |
| Notification | TBD | Customer notifications | Planned |

Cognito owns identity. The User Service owns profile data only.

## Authentication

Cognito is wired into all three APIs with API Gateway JWT authorizers.

- Email sign-in with email verification.
- Public app client, no client secret.
- Groups: `admins` and `customers`.
- Access tokens: 15 minutes. Refresh tokens: 7 days.
- API Gateway validates the JWT signature, issuer, audience, and expiry.
- Public Product routes: `GET /health`, `GET /products`, `GET /products/{id}`.
- Protected Product routes: `POST /products`, `PUT /products/{id}`, `DELETE /products/{id}`.
- Public User route: `GET /health`.
- Protected User routes: `GET /users/me`, `PUT /users/me`, `GET /users/{sub}`.
- Public Order route: `GET /health`.
- Protected Order routes: `POST /orders`, `GET /orders`, `GET /orders/{id}`.
- Order creation requires `Idempotency-Key`.
- A Cognito `PostConfirmation` Lambda creates the User Service profile at signup. `GET /users/me` remains a lazy fallback.
- Missing, invalid, or expired tokens return `401` before the Lambda runs.

Cognito access tokens are used for API authorization. API Gateway accepts a token when its `aud` or `client_id` matches the configured app client.

**Scope decision:** this stage is primarily authentication-only. Role-based authorization is intentionally deferred. Product writes and User profile reads are not role-restricted. Order reads do enforce ownership: `GET /orders/{id}` returns only the caller's order. The protected endpoints remain development-only until broader authorization is added.

## Technology stack

| Area | Technology |
|---|---|
| Compute | AWS Lambda, ZIP deployments (arm64 Go, x86_64 Python, arm64 Node) |
| HTTP | API Gateway HTTP APIs |
| Data | DynamoDB, access-pattern-driven modeling |
| Identity | Amazon Cognito |
| Events | EventBridge, SQS, DLQs |
| Observability | CloudWatch Logs, metrics, alarms |
| Infrastructure | Manual dev setup now, Terraform planned |
| CI/CD | GitHub Actions, GitHub OIDC, scoped IAM roles |

## Repository structure

```text
.
├── .github/
│   └── workflows/
│       ├── product-service-deploy.yml
│       ├── user-service-deploy.yml
│       └── order-service-deploy.yml
├── services/
│   ├── product-service/
│   │   ├── cmd/
│   │   ├── internal/
│   │   │   ├── config/
│   │   │   ├── httpapi/
│   │   │   └── product/
│   │   ├── .env.example
│   │   ├── go.mod
│   │   └── go.sum
│   ├── user-service/
│   │   ├── user_service/
│   │   ├── tests/
│   │   ├── .env.example
│   │   ├── manage.py
│   │   └── requirements.txt
│   ├── order-service/
│   │   ├── src/
│   │   ├── tests/
│   │   ├── .env.example
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── inventory-service/     # planned
│   └── notification-service/  # planned
├── events/                    # planned event schemas
├── infrastructure/            # planned Terraform
├── .gitignore
└── README.md
```

## Getting started

### Prerequisites

- Go 1.26+
- Python 3.12+ recommended (Django base)
- AWS CLI v2 is recommended for deployments
- `git`, `zip`, `unzip`, `curl`
- An AWS account for deployment

### Run the Product Service locally

```bash
git clone https://github.com/Saker233/serverless-ecommerce.git
cd serverless-ecommerce/services/product-service

cp .env.example app.env
go test ./...
go run ./cmd/local
```

In another terminal:

```bash
curl -i http://localhost:8000/health
```

Expected response:

```json
{
  "status": "ok",
  "service": "product-service",
  "version": "dev",
  "environment": "dev",
  "time": "2026-11-04T03:45:50Z"
}
```

### Run the User Service locally

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

The User Service exposes profile CRUD, lazy profile creation, and the Cognito
signup trigger. Local `/users` calls need trusted headers because API Gateway
is not in front of the local server:

```bash
curl -i http://localhost:8001/users/me \
  -H 'X-Auth-Sub: local-user' \
  -H 'X-Auth-Email: local@example.com' \
  -H 'X-Auth-Token-Use: access'
```

### Configuration

Both services use a local `app.env` file.

- `app.env` is local only and gitignored.
- `.env.example` is the committed template.
- Existing shell environment variables take precedence.
- Lambda configuration is provided through the function's environment variables, not `app.env`.

The Product Service loads `app.env` through `godotenv`; the User Service loads it through `python-dotenv` in Django settings.

Never commit credentials or local secret values.

### Build the Product Lambda artifact

```bash
CGO_ENABLED=0 GOOS=linux GOARCH=arm64 \
  go build -trimpath -ldflags="-s -w -X main.version=dev" \
  -o bootstrap ./cmd/lambda

zip -j bootstrap.zip bootstrap
```

Lambda arm64 is used because Go cross-compiles cleanly and Graviton is cheaper per GB-second than x86_64. The Lambda function architecture must match the binary.

The User Service API Lambda handler is `user_service.handler.handler`, and the Cognito signup trigger handler is `user_service.trigger.handler`. Both use the Python 3.12 runtime.

## Deployment

The current development deployment uses:

- Product Lambda and Product API Gateway HTTP API
- User Lambda and User API Gateway HTTP API
- Order Lambda and Order API Gateway HTTP API
- Cognito PostConfirmation trigger Lambda for user profiles
- DynamoDB tables for products, users, and orders
- CloudWatch Logs with short retention
- Scoped IAM execution roles
- ZIP artifacts for the Go binary, Python package, and Node.js package

Infrastructure is provisioned manually for now. It will move to Terraform so that development and production environments are reproducible.

## CI/CD

`.github/workflows/product-service-deploy.yml` provides:

- **Pull requests:** `go vet`, `go test`, arm64 build, artifact upload.
- **Push to `main`:** test, build, assume an AWS role through GitHub OIDC, update the Lambda, wait for the update, and smoke-test `/health`.

`.github/workflows/user-service-deploy.yml` provides:

- **Pull requests:** run the Django test suite and package the Lambda artifact.
- **Push to `main`:** assume a scoped AWS role through GitHub OIDC, update both the signup trigger Lambda and the User Service API Lambda, and run the `/health` smoke test.

`.github/workflows/order-service-deploy.yml` provides:

- **Pull requests:** run typechecking and tests, then build the Lambda ZIP.
- **Push to `main`:** assume a scoped AWS role through GitHub OIDC, update the Order Lambda, and run the `/health` smoke test.

No long-lived AWS access keys are stored in GitHub. The workflows exchange short-lived GitHub OIDC tokens for temporary AWS credentials and use roles restricted to this repository, branch, and specific Lambda functions.

## Roadmap

| Stage | Scope |
|---|---|
| 1 | Product `/health`, Lambda, API Gateway, CI/CD |
| 2 | Product DynamoDB CRUD, pagination, conditional writes *(implemented)* |
| 3 | Cognito authentication *(implemented)*, authorization *(deferred except order ownership)*, Django User Service *(implemented and deployed)*, Order Service *(implemented and deployed)* |
| 4 | EventBridge, SQS, inventory, notifications, idempotency |
| 5 | Terraform for dev and prod, remote state, least-privilege IAM |
| 6 | Independent pipelines for every service |
| 7 | Observability, distributed tracing, integration and failure testing |

## Security notes

- No secrets are committed to the repository.
- GitHub Actions authenticates to AWS through OIDC, not static keys.
- IAM permissions are scoped to the resources each function needs.
- Lambda functions run outside a VPC; they use AWS service endpoints directly.
- Product reads are public; product writes require a Cognito access token.
- User profile routes require a Cognito access token.
- Authorization is intentionally deferred; protected endpoints are development-only.
- Cognito owns passwords; no service stores credentials.

## License

This project is currently a personal learning project. No license has been selected yet.
