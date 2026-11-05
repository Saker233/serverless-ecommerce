# Notification Service

SQS consumer for order notifications. It is Lambda-only and has no HTTP API.

Current scope:

- Parses `OrderCreated` events from SQS.
- Deduplicates by `eventId + channel` using DynamoDB.
- Renders an order-received email.
- Sends through a dry-run sender.
- Records notification state in DynamoDB.
- Returns partial batch failures so only failed messages are retried.

Not implemented yet:

- Real SES delivery
- Customer email lookup through the User Service
- SMS/push channels
- Notification history/preferences API
- SQS/EventBridge/DynamoDB infrastructure
- CI/CD workflow

## Event

```json
{
  "eventId": "evt_...",
  "eventType": "OrderCreated",
  "eventVersion": 1,
  "occurredAt": "2026-11-05T00:00:00Z",
  "correlationId": "req_...",
  "data": {
    "orderId": "order-...",
    "customerId": "cognito-sub",
    "status": "PENDING",
    "items": [
      { "productId": "product-1", "quantity": 2 }
    ],
    "totalCents": 9998,
    "currency": "EUR",
    "createdAt": "2026-11-05T00:00:00Z"
  }
}
```

## DynamoDB model

```text
PK = CUSTOMER#<sub>
SK = NOTIF#<eventId>#email

Fields:
customerId, eventId, channel, type, status, orderId,
createdAt, updatedAt, providerMessageId, error
```

The deterministic sort key makes deduplication atomic:

```text
attribute_not_exists(PK)
```

Statuses:

```text
PENDING → SENT
        → FAILED
```

A failed or abandoned `PENDING` record is retried when SQS redelivers the
message. A `SENT` record is skipped.

## Dry-run mode

`NOTIFICATION_DRY_RUN=true` is the default. The sender logs the recipient and
subject without calling SES.

```text
recipient = customerId for now
```

Real email delivery needs a customer contact lookup and an SES sender.

## Local checks

```bash
cd services/notification-service
npm install
npm run typecheck
npm test
npm run build
```

## Lambda package

```bash
npm run package
```

Creates `notification-service.zip`.

Handler:

```text
dist/handler.handler
```

Runtime: Node.js 22.

## Configuration

| Variable | Purpose |
|---|---|
| `ENV` | Environment name |
| `SERVICE_NAME` | Service name |
| `VERSION` | Version |
| `LOG_LEVEL` | `debug`, `info`, `warn`, or `error` |
| `AWS_REGION` | AWS region |
| `NOTIFICATION_TABLE` | DynamoDB notifications table |
| `NOTIFICATION_DRY_RUN` | `true` for log-only sending |
