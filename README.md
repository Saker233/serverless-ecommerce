# Serverless E-commerce Platform

A polyglot, event-driven e-commerce backend built on AWS serverless services.

The project explores how to design, deploy, and operate independently deployable microservices using different runtimes while keeping infrastructure, security, and observability production-oriented.

> **Status:** application code and CI/CD are implemented for Product, User, Order, and Notification. The manual dev environment was intentionally torn down. The full dev stack is now defined in CloudFormation under `cloudformation/dev/` and can be created with the AWS CLI steps in [Deployment](#deployment); deployment is pending. Cognito authenticates all three HTTP APIs. Authorization is intentionally deferred except for order ownership checks. Notifications run in dry-run mode.

## Goals

- Build independently deployable services in Go, Python, and TypeScript.
- Give every service its own Lambda function, API, data store, and deployment pipeline.
- Use synchronous HTTP only where an immediate response is required.
- Use EventBridge and SQS for asynchronous, eventually consistent workflows.
- Apply least-privilege IAM, OIDC-based deployments, and structured observability.
- Model DynamoDB around access patterns rather than relational tables.

## Architecture

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

Order Service
  └──► DynamoDB order + outbox
          └──► Streams ──► outbox publisher ──► EventBridge
                                                    └──► SQS
                                                          └──► Notification Lambda
                                                                └──► DynamoDB: notifications
```

Services never read or write another service's DynamoDB table. Cross-service reads use HTTP; side effects use events. The Notification Lambda currently runs in dry-run mode and does not call SES.

## Services

| Service | Runtime | Responsibility | Status |
|---|---|---|---|
| Product | Go + Gin | Product catalog, pricing, categories | CRUD + DynamoDB + CI/CD; CloudFormation-defined |
| User | Python + Django | User profiles | Profile CRUD + DynamoDB + signup trigger + CI/CD; CloudFormation-defined |
| Order | TypeScript + Express | Order lifecycle | CRUD + DynamoDB + idempotency + outbox + CI/CD; CloudFormation-defined |
| Notification | TypeScript | Customer notifications | SQS consumer + deduplication + dry-run sender; CloudFormation-defined |

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
| Infrastructure | CloudFormation for dev; Terraform planned |
| CI/CD | GitHub Actions, GitHub OIDC, scoped IAM roles |

## Repository structure

```text
.
├── .github/
│   └── workflows/
│       ├── product-service-deploy.yml
│       ├── user-service-deploy.yml
│       ├── order-service-deploy.yml
│       └── notification-service-deploy.yml
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
│   │   ├── scripts/
│   │   ├── .env.example
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── notification-service/
│       ├── src/
│       ├── tests/
│       ├── scripts/
│       ├── .env.example
│       ├── package.json
│       └── tsconfig.json
├── cloudformation/
│   └── dev/
│       ├── bootstrap.yaml
│       ├── parent.yaml
│       ├── identity.yaml
│       ├── platform.yaml
│       ├── product.yaml
│       ├── order.yaml
│       └── notification.yaml
├── scripts/
│   └── teardown-dev.sh
├── events/                    # planned event schemas
├── infrastructure/            # planned Terraform
├── .gitignore
└── README.md
```

## Getting started

### Prerequisites

- Go 1.26+
- Python 3.12+ recommended
- Node.js 22+
- AWS CLI v2 is recommended for deployments
- `git`, `zip`, `unzip`, `curl`, `jq`
- `gh` for GitHub secret updates (optional)
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

The dev environment is fully defined in CloudFormation:

```text
cloudformation/dev/
├── bootstrap.yaml       # S3 artifact bucket
├── parent.yaml          # nested stack orchestration
├── identity.yaml        # Cognito, profiles, user API, signup trigger
├── platform.yaml        # EventBridge, notification SQS, DLQ
├── product.yaml         # products table, Lambda, API
├── order.yaml           # orders table, API, outbox publisher
└── notification.yaml    # notifications table, SQS consumer
```

It creates:

- Cognito user pool, app client, groups, and PostConfirmation trigger
- Product, User, Order, and Notification Lambdas
- Three API Gateway HTTP APIs and JWT authorizers
- Four DynamoDB tables
- EventBridge bus, rule, SQS queue, and DLQ
- Lambda event source mappings
- Scoped IAM execution and GitHub OIDC deploy roles
- CloudWatch log groups

### Deploy the dev stack

The stack needs the four Lambda packages and the nested templates in S3 before it can be deployed. Run the steps below from the repository root.

#### 1. Set the shell variables

```bash
export AWS_REGION=eu-west-1
export PROJECT=serverless-ecommerce
export ENV=dev
export STACK_NAME="$PROJECT-$ENV"
export BOOTSTRAP_STACK="$PROJECT-$ENV-bootstrap"
export TEMPLATE_PREFIX=cloudformation/dev
```

#### 2. Build the Lambda packages

Product Service (Go, arm64):

```bash
(cd services/product-service && \
  CGO_ENABLED=0 GOOS=linux GOARCH=arm64 \
    go build -trimpath -ldflags="-s -w -X main.version=0.1.0" \
    -o bootstrap ./cmd/lambda && \
  rm -f product-service.zip && \
  zip -j product-service.zip bootstrap)
```

User Service (Python):

```bash
(cd services/user-service && \
  rm -rf build user-service.zip && \
  python3 -m pip install --target build -r requirements.txt && \
  cp -R user_service build/ && \
  find build -name __pycache__ -type d -prune -exec rm -rf {} + && \
  (cd build && zip -qr ../user-service.zip .))
```

Order Service (TypeScript):

```bash
(cd services/order-service && npm ci && npm run package)
```

Notification Service (TypeScript):

```bash
(cd services/notification-service && npm ci && npm run package)
```

Each service must produce its ZIP in the service directory:

```text
services/product-service/product-service.zip
services/user-service/user-service.zip
services/order-service/order-service.zip
services/notification-service/notification-service.zip
```

#### 3. Deploy the bootstrap stack

This creates the S3 bucket that stores the templates and Lambda packages.

```bash
aws cloudformation deploy \
  --stack-name "$BOOTSTRAP_STACK" \
  --template-file cloudformation/dev/bootstrap.yaml \
  --parameter-overrides \
      ProjectName="$PROJECT" \
      EnvironmentName="$ENV" \
  --no-fail-on-empty-changeset

export ARTIFACT_BUCKET=$(aws cloudformation describe-stacks \
  --stack-name "$BOOTSTRAP_STACK" \
  --query "Stacks[0].Outputs[?OutputKey=='ArtifactBucket'].OutputValue" \
  --output text)
```

#### 4. Upload the templates and packages

```bash
aws s3 cp cloudformation/dev/ \
  "s3://$ARTIFACT_BUCKET/$TEMPLATE_PREFIX/" \
  --recursive

for service in product user order notification; do
  aws s3 cp "services/${service}-service/${service}-service.zip" \
    "s3://$ARTIFACT_BUCKET/${service}-service.zip"
done
```

#### 5. Deploy the parent stack

```bash
export DJANGO_SECRET_KEY=$(openssl rand -hex 32)

aws cloudformation deploy \
  --stack-name "$STACK_NAME" \
  --template-file cloudformation/dev/parent.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
      ProjectName="$PROJECT" \
      EnvironmentName="$ENV" \
      ArtifactBucket="$ARTIFACT_BUCKET" \
      TemplatePrefix="$TEMPLATE_PREFIX" \
      ProductArtifactKey=product-service.zip \
      UserArtifactKey=user-service.zip \
      OrderArtifactKey=order-service.zip \
      NotificationArtifactKey=notification-service.zip \
      DjangoSecretKey="$DJANGO_SECRET_KEY" \
      NotificationDryRun=true \
      LogRetentionInDays=7 \
      GitHubOwner=Saker233 \
      GitHubRepo=serverless-ecommerce \
      GitHubBranch=main \
  --no-fail-on-empty-changeset
```

This creates the nested stacks in dependency order:

```text
bootstrap → platform → identity → product → order → notification
```

If a nested stack fails, inspect the parent events first:

```bash
aws cloudformation describe-stack-events \
  --stack-name "$STACK_NAME" \
  --query 'StackEvents[?ResourceStatus==`CREATE_FAILED`].[LogicalResourceId,ResourceStatusReason]' \
  --output table
```

The Django secret is a CloudFormation `NoEcho` parameter. It should move to SSM Parameter Store or Secrets Manager before production.

#### 6. Read the stack outputs

```bash
aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --query 'Stacks[0].Outputs' \
  --output table
```

Capture the API endpoints, Cognito IDs, and deploy role ARNs:

```bash
get_output() {
  aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" \
    --output text
}

export USER_API=$(get_output UserApiEndpoint)
export PRODUCT_API=$(get_output ProductApiEndpoint)
export ORDER_API=$(get_output OrderApiEndpoint)
export POOL_ID=$(get_output UserPoolId)
export CLIENT_ID=$(get_output UserPoolClientId)
```

#### 7. Create Cognito test users

Cognito users are data, not infrastructure, so they are created with the CLI.

```bash
read -rsp "Admin password: " ADMIN_PASSWORD; echo
read -rsp "Customer password: " CUSTOMER_PASSWORD; echo
```

Admin user:

```bash
aws cognito-idp admin-create-user \
  --user-pool-id "$POOL_ID" \
  --username admin@example.com \
  --user-attributes \
      Name=email,Value=admin@example.com \
      Name=email_verified,Value=true \
  --message-action SUPPRESS

aws cognito-idp admin-set-user-password \
  --user-pool-id "$POOL_ID" \
  --username admin@example.com \
  --password "$ADMIN_PASSWORD" \
  --permanent

aws cognito-idp admin-add-user-to-group \
  --user-pool-id "$POOL_ID" \
  --username admin@example.com \
  --group-name admins
```

Customer user:

```bash
aws cognito-idp admin-create-user \
  --user-pool-id "$POOL_ID" \
  --username customer@example.com \
  --user-attributes \
      Name=email,Value=customer@example.com \
      Name=email_verified,Value=true \
  --message-action SUPPRESS

aws cognito-idp admin-set-user-password \
  --user-pool-id "$POOL_ID" \
  --username customer@example.com \
  --password "$CUSTOMER_PASSWORD" \
  --permanent

aws cognito-idp admin-add-user-to-group \
  --user-pool-id "$POOL_ID" \
  --username customer@example.com \
  --group-name customers
```

#### 8. Update the GitHub Actions secrets

```bash
gh secret set PRODUCT_API_URL --body "$PRODUCT_API"
gh secret set USER_SERVICE_API_URL --body "$USER_API"
gh secret set ORDER_SERVICE_API_URL --body "$ORDER_API"

gh secret set AWS_ROLE_ARN --body "$(get_output ProductDeployRoleArn)"
gh secret set USER_SERVICE_ROLE_ARN --body "$(get_output UserDeployRoleArn)"
gh secret set ORDER_SERVICE_ROLE_ARN --body "$(get_output OrderDeployRoleArn)"
gh secret set NOTIFICATION_SERVICE_ROLE_ARN --body "$(get_output NotificationDeployRoleArn)"
```

#### 9. Run the health checks

```bash
curl -i "$PRODUCT_API/health"
curl -i "$USER_API/health"
curl -i "$ORDER_API/health"
```

Expected: HTTP `200` from each endpoint.

Protected routes should reject unauthenticated requests:

```bash
curl -i "$ORDER_API/orders"
```

Expected: HTTP `401`.

### Teardown

Delete the parent stack, which removes all nested stacks:

```bash
aws cloudformation delete-stack --stack-name "$STACK_NAME"
aws cloudformation wait stack-delete-complete --stack-name "$STACK_NAME"
```

The bootstrap stack and its artifact bucket are separate. Empty the bucket first, then delete the stack:

```bash
aws s3 rm "s3://$ARTIFACT_BUCKET" --recursive

aws cloudformation delete-stack --stack-name "$BOOTSTRAP_STACK"
aws cloudformation wait stack-delete-complete --stack-name "$BOOTSTRAP_STACK"
```

`ARTIFACT_BUCKET`, `STACK_NAME`, and `BOOTSTRAP_STACK` come from the deployment steps above. The legacy `scripts/teardown-dev.sh` only covers the old manually created resources and refuses to run while a matching CloudFormation stack exists.

Terraform remains the planned production IaC path.

## CI/CD

`.github/workflows/product-service-deploy.yml` provides:

- **Pull requests:** `go vet`, `go test`, arm64 build, artifact upload.
- **Push to `main`:** test, build, assume an AWS role through GitHub OIDC, update the Lambda, wait for the update, and smoke-test `/health`.

`.github/workflows/user-service-deploy.yml` provides:

- **Pull requests:** run the Django test suite and package the Lambda artifact.
- **Push to `main`:** assume a scoped AWS role through GitHub OIDC, update both the signup trigger Lambda and the User Service API Lambda, and run the `/health` smoke test.

`.github/workflows/order-service-deploy.yml` provides:

- **Pull requests:** run typechecking and tests, then build the Lambda ZIP.
- **Push to `main`:** assume a scoped AWS role through GitHub OIDC, update both the Order API Lambda and the outbox publisher Lambda, and run the `/health` smoke test on the API.

`.github/workflows/notification-service-deploy.yml` provides:

- **Pull requests:** run typechecking and tests, then build the Lambda ZIP.
- **Push to `main`:** assume a scoped AWS role through GitHub OIDC and update the Notification Lambda.

No long-lived AWS access keys are stored in GitHub. The workflows exchange short-lived GitHub OIDC tokens for temporary AWS credentials and use roles restricted to this repository, branch, and specific Lambda functions.

## Roadmap

| Stage | Scope |
|---|---|
| 1 | Product `/health`, Lambda, API Gateway, CI/CD |
| 2 | Product DynamoDB CRUD, pagination, conditional writes *(implemented)* |
| 3 | Cognito authentication *(implemented)*, authorization *(deferred except order ownership)*, Django User Service *(implemented)*, Order Service *(implemented)*; CloudFormation-defined |
| 4 | Order outbox/publisher + Notification consumer + EventBridge/SQS *(implemented; CloudFormation-defined)* |
| 5 | CloudFormation dev stack *(implemented)*; Terraform for dev and prod next |
| 6 | Independent pipelines for every service *(implemented)* |
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
- CloudFormation uses a `NoEcho` Django secret parameter for dev; move it to SSM/Secrets Manager before production.
- Notification delivery is dry-run only; no customer email is sent.

## License

This project is currently a personal learning project. No license has been selected yet.
