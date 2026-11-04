# Order Service

TypeScript + Express base for the Order Service. It runs locally as an HTTP
server and on AWS Lambda through `serverless-http`.

Current scope:

- Express app factory
- `GET /health`
- JSON request logging with correlation IDs
- JSON 404 and 500 responses
- Local server
- Lambda handler
- Health tests

Order CRUD, DynamoDB, Cognito claims extraction, Product Service calls, and
event publishing are not implemented yet.

## Local development

```bash
cd services/order-service
npm install
cp .env.example app.env
npm run dev
```

Test:

```bash
curl -i http://localhost:8002/health
```

Run the checks:

```bash
npm run typecheck
npm test
npm run build
```

## Lambda

Handler:

```text
dist/lambda.handler
```

The Lambda runtime is Node.js 22. The deployment package needs `dist/`,
production `node_modules`, and `package.json`.

## Configuration

| Variable | Purpose |
|---|---|
| `ENV` | Environment name |
| `SERVICE_NAME` | Service name |
| `VERSION` | Version |
| `LOG_LEVEL` | `debug`, `info`, `warn`, or `error` |
| `PORT` | Local HTTP port |
| `ORDERS_TABLE` | Planned DynamoDB table |
| `PRODUCT_SERVICE_URL` | Planned Product Service endpoint |
| `AWS_PROFILE` | Local AWS profile |
| `AWS_REGION` | AWS region |

`app.env` is gitignored. `.env.example` is the committed template.
