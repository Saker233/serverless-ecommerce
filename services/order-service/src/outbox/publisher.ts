import {
  EventBridgeClient,
  PutEventsCommand,
  type PutEventsCommandOutput,
} from "@aws-sdk/client-eventbridge";
import { DeleteCommand, DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import type {
  DynamoDBBatchResponse,
  DynamoDBRecord,
  DynamoDBStreamEvent,
} from "aws-lambda";

import { loadConfig } from "../config";
import { createDocumentClient } from "../db";

const eventSource = "com.serverless-ecommerce.order";

interface OutboxItem {
  PK: string;
  SK: string;
  eventId: string;
  eventType: string;
  eventVersion: number;
  occurredAt: string;
  correlationId: string;
  data: unknown;
}

export interface PublisherDependencies {
  eventBridge: {
    send(command: PutEventsCommand): Promise<PutEventsCommandOutput>;
  };
  documents: {
    send(command: DeleteCommand): Promise<unknown>;
  };
  eventBusName: string;
  tableName: string;
}

export function createPublisherHandler(dependencies: PublisherDependencies) {
  return async function handler(
    event: DynamoDBStreamEvent,
  ): Promise<DynamoDBBatchResponse> {
    const failures: Array<{ itemIdentifier: string }> = [];
    const items = event.Records.map((record) => ({
      record,
      item: outboxItemFromRecord(record),
    })).filter(
      (entry): entry is { record: DynamoDBRecord; item: OutboxItem } =>
        entry.item !== null,
    );

    for (let offset = 0; offset < items.length; offset += 10) {
      const chunk = items.slice(offset, offset + 10);
      const entries = chunk.map(({ item }) => ({
        Source: eventSource,
        DetailType: item.eventType,
        Detail: JSON.stringify({
          eventId: item.eventId,
          eventType: item.eventType,
          eventVersion: item.eventVersion,
          occurredAt: item.occurredAt,
          correlationId: item.correlationId,
          data: item.data,
        }),
        EventBusName: dependencies.eventBusName,
        Time: new Date(item.occurredAt),
      }));

      let response: PutEventsCommandOutput;
      try {
        response = await dependencies.eventBridge.send(
          new PutEventsCommand({ Entries: entries }),
        );
      } catch {
        failures.push(
          ...chunk.map(({ record }) => ({
            itemIdentifier: recordIdentifier(record),
          })),
        );
        continue;
      }

      for (let index = 0; index < chunk.length; index += 1) {
        const { record, item } = chunk[index];
        const result = response.Entries?.[index];

        if (!result || result.ErrorCode) {
          failures.push({ itemIdentifier: recordIdentifier(record) });
          continue;
        }

        try {
          await dependencies.documents.send(
            new DeleteCommand({
              TableName: dependencies.tableName,
              Key: {
                PK: item.PK,
                SK: item.SK,
              },
            }),
          );
        } catch {
          // The event was published, but the outbox item still exists.
          // Retrying re-publishes it; consumers deduplicate by eventId.
          failures.push({ itemIdentifier: recordIdentifier(record) });
        }
      }
    }

    return { batchItemFailures: failures };
  };
}

function recordIdentifier(record: DynamoDBRecord): string {
  return record.eventID ?? record.dynamodb?.SequenceNumber ?? "";
}

export function outboxItemFromRecord(
  record: DynamoDBRecord,
): OutboxItem | null {
  if (!record.dynamodb?.NewImage) {
    return null;
  }

  const item = unmarshall(
    record.dynamodb.NewImage as Parameters<typeof unmarshall>[0],
  ) as Record<string, unknown>;

  if (typeof item.SK !== "string" || !item.SK.startsWith("OUTBOX#")) {
    return null;
  }

  if (
    typeof item.PK !== "string" ||
    typeof item.eventId !== "string" ||
    typeof item.eventType !== "string" ||
    typeof item.occurredAt !== "string" ||
    typeof item.correlationId !== "string"
  ) {
    return null;
  }

  return {
    PK: item.PK,
    SK: item.SK,
    eventId: item.eventId,
    eventType: item.eventType,
    eventVersion: Number(item.eventVersion ?? 1),
    occurredAt: item.occurredAt,
    correlationId: item.correlationId,
    data: item.data,
  };
}

const config = loadConfig();

export const handler = createPublisherHandler({
  eventBridge: new EventBridgeClient({}),
  documents: createDocumentClient(),
  eventBusName: config.eventBusName,
  tableName: config.ordersTable,
});
