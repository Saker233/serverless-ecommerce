import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

import {
  type NotificationChannel,
  type NotificationRecord,
  notificationSortKey,
} from "./domain";

export interface NotificationRepository {
  create(record: NotificationRecord): Promise<boolean>;
  get(
    customerId: string,
    eventId: string,
    channel: NotificationChannel,
  ): Promise<NotificationRecord | null>;
  markSent(record: NotificationRecord, providerMessageId: string): Promise<void>;
  markFailed(record: NotificationRecord, error: string): Promise<void>;
}

export class DynamoNotificationRepository implements NotificationRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async create(record: NotificationRecord): Promise<boolean> {
    try {
      await this.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: toItem(record),
          ConditionExpression: "attribute_not_exists(PK)",
        }),
      );
      return true;
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) {
        return false;
      }

      throw error;
    }
  }

  async get(
    customerId: string,
    eventId: string,
    channel: NotificationChannel,
  ): Promise<NotificationRecord | null> {
    const response = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: key(customerId, eventId, channel),
        ConsistentRead: true,
      }),
    );

    return response.Item ? fromItem(response.Item) : null;
  }

  async markSent(
    record: NotificationRecord,
    providerMessageId: string,
  ): Promise<void> {
    await this.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: key(record.customerId, record.eventId, record.channel),
        UpdateExpression:
          "SET #status = :sent, #providerMessageId = :providerMessageId, #updatedAt = :updatedAt",
        ExpressionAttributeNames: {
          "#status": "status",
          "#providerMessageId": "providerMessageId",
          "#updatedAt": "updatedAt",
        },
        ExpressionAttributeValues: {
          ":sent": "SENT",
          ":providerMessageId": providerMessageId,
          ":updatedAt": new Date().toISOString(),
        },
      }),
    );
  }

  async markFailed(
    record: NotificationRecord,
    error: string,
  ): Promise<void> {
    await this.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: key(record.customerId, record.eventId, record.channel),
        UpdateExpression:
          "SET #status = :failed, #error = :error, #updatedAt = :updatedAt",
        ExpressionAttributeNames: {
          "#status": "status",
          "#error": "error",
          "#updatedAt": "updatedAt",
        },
        ExpressionAttributeValues: {
          ":failed": "FAILED",
          ":error": error.slice(0, 1000),
          ":updatedAt": new Date().toISOString(),
        },
      }),
    );
  }
}

function key(
  customerId: string,
  eventId: string,
  channel: NotificationChannel,
) {
  return {
    PK: `CUSTOMER#${customerId}`,
    SK: notificationSortKey(eventId, channel),
  };
}

function toItem(record: NotificationRecord): Record<string, unknown> {
  return {
    PK: `CUSTOMER#${record.customerId}`,
    SK: notificationSortKey(record.eventId, record.channel),
    customerId: record.customerId,
    eventId: record.eventId,
    channel: record.channel,
    type: record.type,
    status: record.status,
    orderId: record.orderId,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(record.providerMessageId
      ? { providerMessageId: record.providerMessageId }
      : {}),
    ...(record.error ? { error: record.error } : {}),
  };
}

function fromItem(item: Record<string, unknown>): NotificationRecord {
  return {
    customerId: String(item.customerId),
    eventId: String(item.eventId),
    channel: item.channel as NotificationChannel,
    type: String(item.type),
    status: item.status as NotificationRecord["status"],
    orderId: String(item.orderId),
    createdAt: String(item.createdAt),
    updatedAt: String(item.updatedAt),
    ...(item.providerMessageId
      ? { providerMessageId: String(item.providerMessageId) }
      : {}),
    ...(item.error ? { error: String(item.error) } : {}),
  };
}
