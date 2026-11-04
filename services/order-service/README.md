# Order Service

TypeScript + Express Order Service. It runs locally as an HTTP server and on
AWS Lambda through `serverless-http`.

Current scope:

- Express app factory
- `GET /health`
- `POST /orders`
- `GET /orders/{id}`
- `GET /orders`
- DynamoDB repository using AWS SDK v3
- Idempotent order creation with `Idempotency-Key`
- Customer-based listing through a GSI
- Cursor pagination
- Correlation IDs, JSON logging, and JSON errors
- Cognito claim extraction and `token_use == "access"` enforcement
- Lambda handler
- Tests

Not implemented yet:

- Product Service price validation
- Order status transitions
- EventBridge/SQS publishing
- Order Lambda/API Gateway deployment
- CI/CD workflow

## Endpoints

| Method | Path | Auth |
|---|---|---|
| `GET` | `/health` | Public |
| `POST` | `/orders` | Cognito access token + `Idempotency-Key` |
| `GET` | `/orders/{id}` | Cognito access token |
| `GET` | `/orders` | Cognito access token |

The customer ID comes from the token `sub`. `GET /orders/{id}` only returns the
caller's order.

## Storage

```text
Table: serverless-ecommerce-dev-orders

Order:
PK = ORDER#<orderId>
SK = META

Customer listing:
GSI1PK = CUSTOMER#<sub>
GSI1SK = <createdAt>#<orderId>
Index: CustomerIndex

Idempotency:
PK = IDEM#<sub>#<idempotency-key>
SK = META
TTL = expiresAt (24 hours)
```

## Local development

```bash
cd services/order-service
npm install
cp .env.example app.env
npm run dev
```

Health:

```bash
curl -i http://localhost:8002/health
```

Local order calls need trusted auth headers because API Gateway is not in front
of the local server:

```bash
curl -i -X POST http://localhost:8002/orders \
  -H 'Content-Type: application/json' \
  -H 'X-Auth-Sub: local-user' \
  -H 'X-Auth-Token-Use: access' \
  -H 'Idempotency-Key: local-key-1' \
  -d '{
    "items": [{
      "productId": "product-1",
      "sku": "SKU-1",
      "name": "Mechanical Keyboard",
      "quantity": 2,
      "unitPriceCents": 4999,
      "currency": "EUR"
    }]
  }'
```

Run the checks:

```bash
npm run typecheck
npm test
npm run build
```

## Lambda packaging

```bash
npm run package
```

This builds TypeScript, installs production dependencies into a staging
directory, and creates:

```text
order-service.zip
```

The handler is:

```text
dist/lambda.handler
```

Runtime: Node.js 22. The ZIP contains `dist/`, production `node_modules`, and
`package.json`. `app.env` is not packaged.

## Configuration

| Variable | Purpose |
|---|---|
| `ENV` | Environment name |
| `SERVICE_NAME` | Service name |
| `VERSION` | Version |
| `LOG_LEVEL` | `debug`, `info`, `warn`, or `error` |
| `PORT` | Local HTTP port |
| `ORDERS_TABLE` | DynamoDB orders table |
| `PRODUCT_SERVICE_URL` | Planned Product Service endpoint |
| `AWS_PROFILE` | Local AWS profile |
| `AWS_REGION` | AWS region |

`app.env` is gitignored. `.env.example` is the committed template.
