# Serverless E-commerce Platform

A polyglot, event-driven e-commerce backend built on AWS serverless services.

The project explores how to design, deploy, and operate independently deployable microservices using different runtimes while keeping infrastructure, security, and observability production-oriented.

> **Status:** early development. The Product Service health endpoint is deployed to Lambda behind API Gateway, with CI/CD through GitHub Actions. Product CRUD and DynamoDB are next.

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
  │
  ▼
API Gateway HTTP API
  │  GET /health
  ▼
Lambda: product-service
  │  Go + Gin
  ▼
CloudWatch Logs
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
| Product | Go + Gin | Product catalog, pricing, categories | Health endpoint + CI/CD |
| User | Python + Django | User profiles | Planned |
| Order | TypeScript + Express | Order lifecycle | Planned |
| Inventory | TBD | Stock reservations and movements | Planned |
| Notification | TBD | Customer notifications | Planned |

Cognito will own identity. The User Service will own profile data only.

## Technology stack

| Area | Technology |
|---|---|
| Compute | AWS Lambda, ZIP deployments, arm64 |
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
│       └── product-service-deploy.yml
├── services/
│   ├── product-service/
│   │   ├── cmd/
│   │   ├── internal/
│   │   ├── .env.example
│   │   ├── go.mod
│   │   └── go.sum
│   ├── user-service/          # planned
│   ├── order-service/         # planned
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

### Configuration

Local configuration is loaded from `app.env` through `godotenv`.

- `app.env` is local only and gitignored.
- `.env.example` is the committed template.
- Existing shell environment variables take precedence over `app.env`.
- Lambda configuration is provided through the function's environment variables, not `app.env`.

Never commit credentials or local secret values.

### Build the Lambda artifact

```bash
CGO_ENABLED=0 GOOS=linux GOARCH=arm64 \
  go build -trimpath -ldflags="-s -w -X main.version=dev" \
  -o bootstrap ./cmd/lambda

zip -j bootstrap.zip bootstrap
```

Lambda arm64 is used because Go cross-compiles cleanly and Graviton is cheaper per GB-second than x86_64. The Lambda function architecture must match the binary.

## Deployment

The current development deployment uses:

- One Lambda function for the Product Service
- One API Gateway HTTP API
- CloudWatch Logs with short retention
- A scoped IAM execution role
- A ZIP artifact containing the `bootstrap` binary

Infrastructure is provisioned manually for now. It will move to Terraform so that development and production environments are reproducible.

## CI/CD

`.github/workflows/product-service-deploy.yml` provides:

- **Pull requests:** `go vet`, `go test`, arm64 build, artifact upload.
- **Push to `main`:** test, build, assume an AWS role through GitHub OIDC, update the Lambda, wait for the update, and smoke-test `/health`.

No long-lived AWS access keys are stored in GitHub. The workflow exchanges a short-lived GitHub OIDC token for temporary AWS credentials and uses a role restricted to this repository, branch, and Lambda function.

## Roadmap

| Stage | Scope |
|---|---|
| 1 | Product `/health`, Lambda, API Gateway, CI/CD |
| 2 | Product DynamoDB CRUD, pagination, conditional writes |
| 3 | User and Order services, Cognito authentication |
| 4 | EventBridge, SQS, inventory, notifications, idempotency |
| 5 | Terraform for dev and prod, remote state, least-privilege IAM |
| 6 | Independent pipelines for every service |
| 7 | Observability, distributed tracing, integration and failure testing |

## Security notes

- No secrets are committed to the repository.
- GitHub Actions authenticates to AWS through OIDC, not static keys.
- IAM permissions are scoped to the resources each function needs.
- Lambda functions run outside a VPC; they use AWS service endpoints directly.
- The current dev endpoints are not yet protected by Cognito. Authentication arrives in Stage 3.

## License

This project is currently a personal learning project. No license has been selected yet.
