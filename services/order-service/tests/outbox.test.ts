import type { PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { marshall } from "@aws-sdk/util-dynamodb";
import type { DynamoDBRecord, DynamoDBStreamEvent } from "aws-lambda";
import { describe, expect, it } from "vitest";

import {
  createPublisherHandler,
  outboxItemFromRecord,
} from "../src/outbox/publisher";

function streamEvent(eventId = "event-id-1"): DynamoDBStreamEvent {
  const record = {
    eventID: eventId,
    eventName: "INSERT",
    eventSource: "aws:dynamodb",
    dynamodb: {
      NewImage: marshall({
        PK: "ORDER#order-1",
        SK: "OUTBOX#outbox-1",
        eventId: "outbox-1",
        eventType: "OrderCreated",
        eventVersion: 1,
        occurredAt: "2026-01-01T00:00:00.000Z",
        correlationId: "request-1",
        data: {
          orderId: "order-1",
          customerId: "user-1",
          totalCents: 1000,
          currency: "EUR",
        },
      }),
    },
  } as unknown as DynamoDBRecord;

  return { Records: [record] };
}

describe("outbox publisher", () => {
  it("maps a DynamoDB outbox record to an event", () => {
    const item = outboxItemFromRecord(streamEvent().Records[0]);

    expect(item).toMatchObject({
      PK: "ORDER#order-1",
      SK: "OUTBOX#outbox-1",
      eventId: "outbox-1",
      eventType: "OrderCreated",
      correlationId: "request-1",
    });
  });

  it("publishes and deletes the outbox item", async () => {
    const published: PutEventsCommand[] = [];
    const deleted: unknown[] = [];

    const handler = createPublisherHandler({
      eventBridge: {
        send: async (command) => {
          published.push(command);
          return { FailedEntryCount: 0, Entries: [{}] };
        },
      },
      documents: {
        send: async (command) => {
          deleted.push(command.input);
          return {};
        },
      },
      eventBusName: "test-bus",
      tableName: "test-orders",
    });

    const result = await handler(streamEvent());

    expect(result.batchItemFailures).toEqual([]);
    expect(published).toHaveLength(1);
    expect(published[0].input.Entries?.[0]).toMatchObject({
      Source: "com.serverless-ecommerce.order",
      DetailType: "OrderCreated",
      EventBusName: "test-bus",
    });
    expect(deleted).toHaveLength(1);
  });

  it("reports an EventBridge failure without deleting the outbox item", async () => {
    const deleted: unknown[] = [];

    const handler = createPublisherHandler({
      eventBridge: {
        send: async () => ({
          FailedEntryCount: 1,
          Entries: [{ ErrorCode: "ThrottlingException" }],
        }),
      },
      documents: {
        send: async (command) => {
          deleted.push(command.input);
          return {};
        },
      },
      eventBusName: "test-bus",
      tableName: "test-orders",
    });

    const result = await handler(streamEvent());

    expect(result.batchItemFailures).toEqual([
      { itemIdentifier: "event-id-1" },
    ]);
    expect(deleted).toHaveLength(0);
  });
});
