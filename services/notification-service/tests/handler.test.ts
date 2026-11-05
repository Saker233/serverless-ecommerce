import type { SQSEvent } from "aws-lambda";
import { describe, expect, it } from "vitest";

import type { OrderCreatedEvent } from "../src/events/orderCreated";
import { createHandler } from "../src/handler";
import { createLogger } from "../src/logger";
import type {
  NotificationChannel,
  NotificationRecord,
} from "../src/notifications/domain";
import type { NotificationRepository } from "../src/notifications/repository";
import type {
  NotificationSender,
  OutboundMessage,
  SendResult,
} from "../src/notifications/sender";
import { NotificationService } from "../src/notifications/service";
import { renderOrderCreated } from "../src/notifications/template";

class FakeRepository implements NotificationRepository {
  readonly records = new Map<string, NotificationRecord>();

  async create(record: NotificationRecord): Promise<boolean> {
    const key = this.key(record.customerId, record.eventId, record.channel);
    if (this.records.has(key)) {
      return false;
    }

    this.records.set(key, { ...record });
    return true;
  }

  async get(
    customerId: string,
    eventId: string,
    channel: NotificationChannel,
  ): Promise<NotificationRecord | null> {
    return this.records.get(this.key(customerId, eventId, channel)) ?? null;
  }

  async markSent(
    record: NotificationRecord,
    providerMessageId: string,
  ): Promise<void> {
    const existing = await this.get(
      record.customerId,
      record.eventId,
      record.channel,
    );

    if (existing) {
      existing.status = "SENT";
      existing.providerMessageId = providerMessageId;
    }
  }

  async markFailed(
    record: NotificationRecord,
    error: string,
  ): Promise<void> {
    const existing = await this.get(
      record.customerId,
      record.eventId,
      record.channel,
    );

    if (existing) {
      existing.status = "FAILED";
      existing.error = error;
    }
  }

  private key(
    customerId: string,
    eventId: string,
    channel: NotificationChannel,
  ): string {
    return `${customerId}:${eventId}:${channel}`;
  }
}

class FakeSender implements NotificationSender {
  readonly sent: OutboundMessage[] = [];
  fail = false;

  async send(message: OutboundMessage): Promise<SendResult> {
    if (this.fail) {
      throw new Error("provider unavailable");
    }

    this.sent.push(message);
    return { providerMessageId: "provider-1" };
  }
}

function orderCreatedEvent(
  overrides: Partial<OrderCreatedEvent["data"]> = {},
): OrderCreatedEvent {
  return {
    eventId: "event-1",
    eventType: "OrderCreated",
    eventVersion: 1,
    occurredAt: "2026-01-01T00:00:00.000Z",
    correlationId: "request-1",
    data: {
      orderId: "order-1",
      customerId: "user-1",
      status: "PENDING",
      items: [{ productId: "product-1", quantity: 2 }],
      totalCents: 9998,
      currency: "EUR",
      createdAt: "2026-01-01T00:00:00.000Z",
      ...overrides,
    },
  };
}

function sqsEvent(body: unknown, messageId = "message-1"): SQSEvent {
  return {
    Records: [
      {
        messageId,
        body: JSON.stringify(body),
        receiptHandle: "receipt-1",
        attributes: {
          ApproximateReceiveCount: "1",
          SentTimestamp: "0",
          SenderId: "sender",
          ApproximateFirstReceiveTimestamp: "0",
        },
        messageAttributes: {},
        md5OfBody: "",
        eventSource: "aws:sqs",
        eventSourceARN: "arn:aws:sqs:eu-west-1:123456789012:queue",
        awsRegion: "eu-west-1",
      },
    ],
  };
}

function buildHandler() {
  const repository = new FakeRepository();
  const sender = new FakeSender();
  const logger = createLogger("error");
  const service = new NotificationService(
    repository,
    sender,
    logger,
    () => new Date("2026-01-01T00:00:00.000Z"),
  );

  return {
    handler: createHandler(service, logger),
    repository,
    sender,
  };
}

describe("notification handler", () => {
  it("sends and records an order-created notification", async () => {
    const { handler, repository, sender } = buildHandler();
    const event = orderCreatedEvent();

    const result = await handler(sqsEvent(event));

    expect(result.batchItemFailures).toEqual([]);
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0]).toMatchObject({
      recipient: "user-1",
      subject: "We received your order order-1",
    });

    const record = await repository.get("user-1", "event-1", "email");
    expect(record).toMatchObject({
      status: "SENT",
      providerMessageId: "provider-1",
      orderId: "order-1",
    });
  });

  it("handles an EventBridge envelope from SQS", async () => {
    const { handler, sender } = buildHandler();
    const event = orderCreatedEvent();

    const result = await handler(
      sqsEvent({
        version: "0",
        source: "com.serverless-ecommerce.order",
        "detail-type": "OrderCreated",
        detail: event,
      }),
    );

    expect(result.batchItemFailures).toEqual([]);
    expect(sender.sent).toHaveLength(1);
  });

  it("deduplicates the same event", async () => {
    const { handler, sender } = buildHandler();
    const event = sqsEvent(orderCreatedEvent());

    await handler(event);
    await handler(event);

    expect(sender.sent).toHaveLength(1);
  });

  it("returns a batch failure when the sender fails", async () => {
    const { handler, repository, sender } = buildHandler();
    sender.fail = true;

    const result = await handler(sqsEvent(orderCreatedEvent()));

    expect(result.batchItemFailures).toEqual([
      { itemIdentifier: "message-1" },
    ]);
    const record = await repository.get("user-1", "event-1", "email");
    expect(record?.status).toBe("FAILED");
  });

  it("returns a batch failure for an invalid event", async () => {
    const { handler } = buildHandler();

    const result = await handler(
      sqsEvent({ eventType: "OrderCreated", data: {} }),
    );

    expect(result.batchItemFailures).toEqual([
      { itemIdentifier: "message-1" },
    ]);
  });

  it("skips unsupported event types", async () => {
    const { handler, sender } = buildHandler();

    const result = await handler(sqsEvent({ eventType: "OrderConfirmed" }));

    expect(result.batchItemFailures).toEqual([]);
    expect(sender.sent).toHaveLength(0);
  });

  it("renders totals in the email", () => {
    const message = renderOrderCreated(orderCreatedEvent());

    expect(message.text).toContain("99.98 EUR");
    expect(message.html).toContain("order-1");
  });
});
