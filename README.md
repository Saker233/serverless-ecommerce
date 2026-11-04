# Serverless E-commerce Platform

A production-oriented, polyglot serverless e-commerce platform on AWS.

**Current status:** Stage 1 — the Go/Gin Product Service is deployed manually to Lambda behind API Gateway. GitHub Actions CI/CD is wired through GitHub OIDC.

Planned services:

| Service | Runtime | Status |
|---|---|---|
| Product | Go + Gin | Deployed manually |
| User | Python + Django | Planned |
| Order | TypeScript + Express | Planned |
| Inventory | TBD | Planned |
| Notification | TBD | Planned |

---

## Architecture

Current Stage 1 request path:

```text
Client
  │
  ▼
API Gateway HTTP API
  │  GET /health
  ▼
Lambda: serverless-ecommerce-dev-product
  │  Go + Gin + aws-lambda-go-api-proxy
  ▼
CloudWatch Logs
```

Later stages add DynamoDB, Cognito, EventBridge, SQS, and the remaining services.

Key decisions:

- **One HTTP API per service**, so services remain independently deployable.
- **Lambda arm64** (Graviton), because Go cross-compiles cleanly and arm64 is cheaper per GB-second.
- **No VPC**, because Lambda can reach AWS services without one.
- **No containers**, because ZIP deployments are sufficient for these services.
- **Manual infrastructure for now**; Terraform comes later.
- **No long-lived AWS keys in GitHub**; GitHub Actions assumes an IAM role through OIDC.
- **Cognito** will handle identity in Stage 3.

---

## Repository layout

```text
.
├── .github/workflows/product-service-deploy.yml
├── .gitignore
├── README.md
└── services/product-service/
    ├── app.env                 # local only, gitignored
    ├── .env.example            # committed template
    ├── go.mod
    ├── go.sum
    ├── cmd/
    │   ├── lambda/main.go
    │   └── local/main.go
    └── internal/
        ├── config/
        └── httpapi/
```

---

## Prerequisites

- AWS account and an IAM admin profile. The examples use `commerce-dev`.
- AWS CLI. These commands work with AWS CLI v1; some newer CLI versions infer OIDC thumbprints automatically.
- Go 1.26 or newer.
- `git`, `zip`, `unzip`, `curl`, `jq`.
- Region: `eu-west-1`.

Set the shell variables used throughout this document:

```bash
export AWS_PROFILE=commerce-dev
export AWS_REGION=eu-west-1
export AWS_DEFAULT_REGION=eu-west-1

export PROJECT=serverless-ecommerce
export ENV=dev
export SERVICE=product

export FN_NAME="$PROJECT-$ENV-$SERVICE"
export ROLE_NAME="$FN_NAME-lambda-role"
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
```

Verify:

```bash
aws sts get-caller-identity
```

---

## Local development

```bash
cd services/product-service
cp .env.example app.env
```

Edit `app.env` with local values. It is **gitignored**; `.env.example` is the committed template.

`config.Load()` loads `app.env` lazily once through `godotenv`. Existing shell environment variables take precedence. To use a different file:

```bash
APP_ENV_FILE=/path/to/other.env go run ./cmd/local
```

Run tests and the local server:

```bash
go test ./...
go run ./cmd/local
```

Test:

```bash
curl -i http://localhost:8000/health
```

Expected:

```json
{
  "status": "ok",
  "service": "product-service",
  "version": "dev",
  "environment": "dev",
  "time": "2026-11-04T03:45:50Z"
}
```

---

## Build the Lambda artifact

Lambda expects a Linux binary named `bootstrap` at the root of the ZIP.

```bash
cd services/product-service

CGO_ENABLED=0 GOOS=linux GOARCH=arm64 \
  go build -trimpath -ldflags="-s -w -X main.version=0.1.0" \
  -o bootstrap ./cmd/lambda

zip -j bootstrap.zip bootstrap
unzip -l bootstrap.zip
file bootstrap
```

Why arm64?

- Lambda arm64 uses AWS Graviton.
- It is cheaper per GB-second than x86_64.
- Go cross-compiles without an ARM machine.
- The Lambda function must be created with `--architectures arm64`, otherwise you get `exec format error`.

`-ldflags "-X main.version=..."` injects the version into the health response.

---

## Manual AWS deployment (Stage 1)

This section recreates the current dev deployment. It creates real AWS resources in `eu-west-1`.

### 1. Create the Lambda execution role

The role is assumed by Lambda. The trust policy allows only the Lambda service:

```bash
cat > /tmp/product-lambda-trust.json <<'JSON'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Service": "lambda.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }
  ]
}
JSON

aws iam create-role \
  --role-name "$ROLE_NAME" \
  --assume-role-policy-document file:///tmp/product-lambda-trust.json
```

Attach only the log permissions needed by this function:

```bash
cat > /tmp/product-lambda-logs-policy.json <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:$AWS_REGION:$ACCOUNT_ID:log-group:/aws/lambda/$FN_NAME:*"
    }
  ]
}
JSON

aws iam put-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-name logs \
  --policy-document file:///tmp/product-lambda-logs-policy.json
```

Verify:

```bash
aws iam list-role-policies --role-name "$ROLE_NAME"
aws iam get-role-policy --role-name "$ROLE_NAME" --policy-name logs
```

### 2. Create the log group

Create the log group before the function so retention is controlled:

```bash
aws logs create-log-group \
  --log-group-name "/aws/lambda/$FN_NAME"

aws logs put-retention-policy \
  --log-group-name "/aws/lambda/$FN_NAME" \
  --retention-in-days 7
```

### 3. Create the Lambda function

```bash
aws lambda create-function \
  --function-name "$FN_NAME" \
  --runtime provided.al2023 \
  --handler bootstrap \
  --architectures arm64 \
  --role "arn:aws:iam::$ACCOUNT_ID:role/$ROLE_NAME" \
  --zip-file fileb://bootstrap.zip \
  --timeout 5 \
  --memory-size 256 \
  --environment "Variables={ENV=$ENV,SERVICE_NAME=product-service,LOG_LEVEL=info,VERSION=0.1.0}"
```

Important arguments:

- `provided.al2023`: custom runtime for a compiled Go binary.
- `handler bootstrap`: the handler name is not used like Python/Node, but Lambda requires the field.
- `architectures arm64`: must match the binary.
- `timeout 5`: keep below API Gateway's integration timeout.
- `memory-size 256`: enough for this service; CPU scales with memory.

Verify:

```bash
aws lambda get-function \
  --function-name "$FN_NAME" \
  --query 'Configuration.[State,Architectures,Runtime,Timeout,MemorySize]' \
  --output text
```

Expected: `Active`, `arm64`, `provided.al2023`, `5`, `256`.

### 4. Create the HTTP API

Create the API:

```bash
API_ID=$(aws apigatewayv2 create-api \
  --name "$FN_NAME-api" \
  --protocol-type HTTP \
  --query ApiId \
  --output text)

echo "$API_ID"
```

Create the Lambda proxy integration:

```bash
INTEGRATION_ID=$(aws apigatewayv2 create-integration \
  --api-id "$API_ID" \
  --integration-type AWS_PROXY \
  --integration-uri "arn:aws:lambda:$AWS_REGION:$ACCOUNT_ID:function:$FN_NAME" \
  --payload-format-version 2.0 \
  --query IntegrationId \
  --output text)

echo "$INTEGRATION_ID"
```

`payload-format-version 2.0` matches `ginadapter.NewV2`.

Create the route and the `$default` stage:

```bash
aws apigatewayv2 create-route \
  --api-id "$API_ID" \
  --route-key 'GET /health' \
  --target "integrations/$INTEGRATION_ID" \
  --authorization-type NONE

aws apigatewayv2 create-stage \
  --api-id "$API_ID" \
  --stage-name '$default' \
  --auto-deploy
```

Allow API Gateway to invoke the function:

```bash
aws lambda add-permission \
  --function-name "$FN_NAME" \
  --statement-id apigw-health \
  --action lambda:InvokeFunction \
  --principal apigateway.amazonaws.com \
  --source-arn "arn:aws:execute-api:$AWS_REGION:$ACCOUNT_ID:$API_ID/*/GET/health"
```

### 5. Verify the public endpoint

```bash
API_ENDPOINT=$(aws apigatewayv2 get-api \
  --api-id "$API_ID" \
  --query ApiEndpoint \
  --output text)

echo "$API_ENDPOINT"
curl -i "$API_ENDPOINT/health"
curl -i "$API_ENDPOINT/does-not-exist"
```

Expected:

- `/health` → `200` with JSON and `X-Correlation-Id`.
- Unknown route → `404`.

Check logs:

```bash
aws logs filter-log-events \
  --log-group-name "/aws/lambda/$FN_NAME" \
  --start-time "$(date -u -d '15 minutes ago' +%s)000" \
  --query 'events[].message' \
  --output text
```

Check cold-start data:

```bash
aws logs filter-log-events \
  --log-group-name "/aws/lambda/$FN_NAME" \
  --start-time "$(date -u -d '15 minutes ago' +%s)000" \
  --filter-pattern "REPORT" \
  --query 'events[].message' \
  --output text
```

### 6. Record the resources

Record these values for the Terraform migration later:

```text
Region: eu-west-1
Function name:
Function ARN:
Execution role ARN:
Log group:
API ID:
API endpoint:
Integration ID:
Route ID:
Stage: $default
Created at:
```

---

## GitHub Actions deployment through OIDC

The workflow is `.github/workflows/product-service-deploy.yml`.

It does **not** create infrastructure. It only updates the existing Lambda.

- Pull requests: vet, test, build arm64, upload the ZIP artifact.
- Push to `main`: same steps, then assume an AWS role through OIDC, update the Lambda, wait for success, and smoke-test `/health`.
- Path filter: only changes under `services/product-service/**` or the workflow file trigger it.

No AWS access keys are stored in GitHub.

### 1. Create the GitHub OIDC provider

Check whether it already exists:

```bash
aws iam list-open-id-connect-providers
```

If the list is empty, create it. AWS CLI v1 requires the thumbprint parameter:

```bash
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list \
    6938fd4d98bab03faadb97b34396831e3780aea1 \
    1c58a3a8518e8759bf075b76b750d4f2df264fcd
```

These are GitHub's known intermediate thumbprints. AWS now validates GitHub through a trusted CA/JWKS, but AWS CLI v1 still requires the parameter.

Get the provider ARN:

```bash
aws iam list-open-id-connect-providers
```

It looks like:

```text
arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com
```

### 2. Create the deploy role

The trust policy restricts the role to:

- The GitHub OIDC provider.
- The `sts.amazonaws.com` audience.
- The `Saker233/serverless-ecommerce` repository.
- The `main` branch.

It includes both subject formats because repositories created after July 15, 2026 may use GitHub's immutable owner/repository IDs in the `sub` claim.

```bash
cat > /tmp/github-actions-product-trust.json <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::$ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": [
            "repo:Saker233/serverless-ecommerce:ref:refs/heads/main",
            "repo:Saker233@*/serverless-ecommerce@*:ref:refs/heads/main"
          ]
        }
      }
    }
  ]
}
JSON

aws iam create-role \
  --role-name github-actions-product-deploy \
  --assume-role-policy-document file:///tmp/github-actions-product-trust.json
```

The second pattern handles immutable claims such as:

```text
repo:Saker233@12345678/serverless-ecommerce@87654321:ref:refs/heads/main
```

Attach only the permissions needed to update and inspect this function:

```bash
cat > /tmp/github-actions-product-deploy.json <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "lambda:UpdateFunctionCode",
        "lambda:GetFunction",
        "lambda:GetFunctionConfiguration"
      ],
      "Resource": "arn:aws:lambda:$AWS_REGION:$ACCOUNT_ID:function:$FN_NAME"
    }
  ]
}
JSON

aws iam put-role-policy \
  --role-name github-actions-product-deploy \
  --policy-name deploy-product \
  --policy-document file:///tmp/github-actions-product-deploy.json
```

Verify:

```bash
aws iam get-role \
  --role-name github-actions-product-deploy \
  --query 'Role.Arn' \
  --output text

aws iam list-role-policies \
  --role-name github-actions-product-deploy
```

### 3. Set GitHub repository secrets

The workflow reads two repository secrets:

| Secret | Value |
|---|---|
| `AWS_ROLE_ARN` | ARN of `github-actions-product-deploy` |
| `PRODUCT_API_URL` | API Gateway endpoint, without a trailing slash |

The role ARN is not a credential, but storing it as a secret is fine. The important rule is that the values are referenced through the `secrets` context in the workflow.

With the GitHub CLI:

```bash
gh secret set AWS_ROLE_ARN \
  --body "arn:aws:iam::$ACCOUNT_ID:role/github-actions-product-deploy"

gh secret set PRODUCT_API_URL \
  --body "$API_ENDPOINT"
```

Or use GitHub:

```text
Repository → Settings → Secrets and variables → Actions → Secrets → New repository secret
```

The workflow references them as:

```yaml
role-to-assume: ${{ secrets.AWS_ROLE_ARN }}
```

and:

```yaml
"${{ secrets.PRODUCT_API_URL }}/health"
```

Do not create AWS access keys for GitHub. OIDC still provides the temporary credentials.

### 4. First deployment

Commit the workflow and push:

```bash
git add .github/workflows/product-service-deploy.yml README.md
git commit -m "ci(product): deploy Lambda on main"
git push origin main
```

Watch the workflow in the repository's **Actions** tab.

The deploy job updates `$LATEST` directly. There is no alias or automatic rollback yet; that comes with production hardening.

---

## Teardown

Delete API Gateway first, then the function, role, logs, and OIDC resources.

```bash
aws apigatewayv2 delete-api --api-id "$API_ID"
aws lambda delete-function --function-name "$FN_NAME"

aws iam delete-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-name logs
aws iam delete-role --role-name "$ROLE_NAME"

aws logs delete-log-group --log-group-name "/aws/lambda/$FN_NAME"

aws iam delete-role-policy \
  --role-name github-actions-product-deploy \
  --policy-name deploy-product
aws iam delete-role --role-name github-actions-product-deploy

aws iam delete-open-id-connect-provider \
  --open-id-connect-provider-arn "arn:aws:iam::$ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com"
```

Only delete the OIDC provider if no other role uses it.

---

## Troubleshooting

| Problem | Cause / fix |
|---|---|
| `--thumbprint-list` required | AWS CLI v1 requires thumbprints. Use the OIDC command above with both GitHub thumbprints. |
| `exec format error` | The binary architecture does not match the Lambda architecture. Rebuild with `GOARCH=arm64` or create the function as x86_64. |
| `502` from API Gateway | The Lambda panicked or returned an invalid response. Check CloudWatch logs. |
| `404` on `/health` | Route key, stage, or integration is wrong. Check `aws apigatewayv2 get-routes --api-id "$API_ID"`. |
| `403` invoking Lambda | Missing `lambda:add-permission`, or the source ARN does not match the route. |
| `Not authorized to perform sts:AssumeRoleWithWebIdentity` | The OIDC trust policy `sub` or `aud` does not match the token. Check the repository and branch, including immutable `@id` claims. |
| `AccessDenied` updating Lambda in Actions | The deploy role policy is missing `lambda:UpdateFunctionCode` or the resource ARN is wrong. |
| Smoke test version mismatch | The workflow builds with `-X main.version=${GITHUB_SHA::7}`; ensure the binary is rebuilt and deployed, not an old artifact. |
| `app.env` not loaded locally | Run from `services/product-service`, or set `APP_ENV_FILE`. |
| `godotenv` cannot find `app.env` | Expected in Lambda; the file is not deployed. Lambda gets configuration from environment variables. |

---

## Roadmap

| Stage | Scope |
|---|---|
| 1 | Product `/health` on Lambda + API Gateway + CI/CD |
| 2 | Product DynamoDB CRUD, pagination, conditional writes |
| 3 | Django User Service + Express Order Service + Cognito |
| 4 | Synchronous product validation + EventBridge + SQS + inventory/notification |
| 5 | Terraform for dev/prod, IAM least privilege, remote state |
| 6 | Independent service pipelines, OIDC, scoped deploy roles |
| 7 | Observability, tracing, integration tests, failure handling |

Manual resources are for **dev only**. Production infrastructure will be created with Terraform.
