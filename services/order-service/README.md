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
- Transactional outbox with an `OrderCreated` event
- DynamoDB Streams publisher Lambda code
- Customer-based listing through a GSI
- Cursor pagination
- Correlation IDs, JSON logging, and JSON errors
- Cognito claim extraction and `token_use == "access"` enforcement
- Lambda handler
- Tests

Not implemented yet:

- Product Service price validation
- Order status transitions
- EventBridge bus, Streams mapping, SQS queues, and notification consumer infrastructure

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

Handlers:

```text
dist/lambda.handler          # API Lambda
dist/outbox/publisher.handler # DynamoDB Streams outbox publisher
```

Runtime: Node.js 22. The ZIP contains `dist/`, production `node_modules`, and
`package.json`. `app.env` is not packaged.

## Outbox

Order creation writes three items in one DynamoDB transaction:

```text
ORDER#<orderId> / META
IDEM#<customerId>#<key> / META
ORDER#<orderId> / OUTBOX#<eventId>
```

The outbox publisher reads DynamoDB Streams, publishes `OrderCreated` to
EventBridge, and deletes the outbox item. If deletion fails, the event may be
published again; consumers deduplicate by `eventId`.

## CI/CD

`.github/workflows/order-service-deploy.yml`:

- Pull requests run typechecking and tests, then build `order-service.zip`.
- Pushes to `main` update both `serverless-ecommerce-dev-order` and `serverless-ecommerce-dev-order-outbox-publisher` through GitHub OIDC.
- The `/health` smoke test runs through `ORDER_SERVICE_API_URL`.

GitHub secrets:

| Secret | Purpose |
|---|---|
| `ORDER_SERVICE_ROLE_ARN` | Scoped deploy role for the Order Lambda |
| `ORDER_SERVICE_API_URL` | API Gateway URL for the smoke test |

## Configuration

| Variable | Purpose |
|---|---|
| `ENV` | Environment name |
| `SERVICE_NAME` | Service name |
| `VERSION` | Version |
| `LOG_LEVEL` | `debug`, `info`, `warn`, or `error` |
| `PORT` | Local HTTP port |
| `ORDERS_TABLE` | DynamoDB orders table |
| `EVENT_BUS_NAME` | EventBridge bus for outbox events |
| `PRODUCT_SERVICE_URL` | Planned Product Service endpoint |
| `AWS_PROFILE` | Local AWS profile |
| `AWS_REGION` | AWS region |

`app.env` is gitignored. `.env.example` is the committed template.
