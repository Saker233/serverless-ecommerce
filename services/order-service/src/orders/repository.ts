import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";

import {
  IdempotencyConflictError,
  type Order,
  ValidationError,
} from "./domain";

const customerIndex = "CustomerIndex";

export interface IdempotencyRecord {
  orderId: string;
  requestHash: string;
  expiresAt: number;
  createdAt: string;
}

export interface CreateOrderPersistence {
  idempotencyKey: string;
  requestHash: string;
  expiresAt: number;
  createdAt: string;
}

export interface CreateOrderResult {
  order: Order;
  created: boolean;
}

export interface ListOrdersResult {
  orders: Order[];
  nextCursor?: string;
}

export interface OrderRepository {
  create(
    order: Order,
    idempotency: CreateOrderPersistence,
  ): Promise<CreateOrderResult>;
  get(orderId: string): Promise<Order | null>;
  listByCustomer(
    customerId: string,
    limit: number,
    cursor?: string,
  ): Promise<ListOrdersResult>;
}

interface CursorPayload {
  customerId: string;
  key: Record<string, unknown>;
}

export class DynamoOrderRepository implements OrderRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async create(
    order: Order,
    idempotency: CreateOrderPersistence,
  ): Promise<CreateOrderResult> {
    const orderRecord = {
      PK: `ORDER#${order.orderId}`,
      SK: "META",
      GSI1PK: `CUSTOMER#${order.customerId}`,
      GSI1SK: `${order.createdAt}#${order.orderId}`,
      ...order,
    };

    const idempotencyRecord = {
      PK: `IDEM#${order.customerId}#${idempotency.idempotencyKey}`,
      SK: "META",
      orderId: order.orderId,
      requestHash: idempotency.requestHash,
      expiresAt: idempotency.expiresAt,
      createdAt: idempotency.createdAt,
    };

    try {
      await this.client.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: this.tableName,
                Item: orderRecord,
                ConditionExpression: "attribute_not_exists(PK)",
              },
            },
            {
              Put: {
                TableName: this.tableName,
                Item: idempotencyRecord,
                ConditionExpression: "attribute_not_exists(PK)",
              },
            },
          ],
        }),
      );

      return { order, created: true };
    } catch (error) {
      if (!(error instanceof TransactionCanceledException)) {
        throw error;
      }

      const reason = error.CancellationReasons?.[1];
      if (reason?.Code !== "ConditionalCheckFailed") {
        throw error;
      }

      const existing = await this.getIdempotency(
        order.customerId,
        idempotency.idempotencyKey,
      );
      if (!existing) {
        throw error;
      }

      if (existing.requestHash !== idempotency.requestHash) {
        throw new IdempotencyConflictError();
      }

      const existingOrder = await this.get(existing.orderId);
      if (!existingOrder) {
        throw new Error("idempotency record points to a missing order");
      }

      return { order: existingOrder, created: false };
    }
  }

  async get(orderId: string): Promise<Order | null> {
    const response = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          PK: `ORDER#${orderId}`,
          SK: "META",
        },
        ConsistentRead: true,
      }),
    );

    if (!response.Item) {
      return null;
    }

    return fromOrderRecord(response.Item);
  }

  async listByCustomer(
    customerId: string,
    limit: number,
    cursor?: string,
  ): Promise<ListOrdersResult> {
    const input = {
      TableName: this.tableName,
      IndexName: customerIndex,
      KeyConditionExpression: "GSI1PK = :customer",
      ExpressionAttributeValues: {
        ":customer": `CUSTOMER#${customerId}`,
      },
      ScanIndexForward: false,
      Limit: limit,
      ExclusiveStartKey: undefined as Record<string, unknown> | undefined,
    };

    if (cursor) {
      const decoded = decodeCursor(cursor);
      if (decoded.customerId !== customerId) {
        throw new ValidationError("invalid pagination cursor");
      }
      input.ExclusiveStartKey = decoded.key;
    }

    const response = await this.client.send(new QueryCommand(input));

    return {
      orders: (response.Items ?? []).map((item) =>
        fromOrderRecord(item as Record<string, unknown>),
      ),
      nextCursor: response.LastEvaluatedKey
        ? encodeCursor(customerId, response.LastEvaluatedKey)
        : undefined,
    };
  }

  private async getIdempotency(
    customerId: string,
    key: string,
  ): Promise<IdempotencyRecord | null> {
    const response = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          PK: `IDEM#${customerId}#${key}`,
          SK: "META",
        },
        ConsistentRead: true,
      }),
    );

    if (!response.Item) {
      return null;
    }

    return {
      orderId: String(response.Item.orderId),
      requestHash: String(response.Item.requestHash),
      expiresAt: Number(response.Item.expiresAt),
      createdAt: String(response.Item.createdAt),
    };
  }
}

function fromOrderRecord(record: Record<string, unknown>): Order {
  const {
    PK: _pk,
    SK: _sk,
    GSI1PK: _gsi1pk,
    GSI1SK: _gsi1sk,
    ...order
  } = record;

  return order as unknown as Order;
}

function encodeCursor(
  customerId: string,
  key: Record<string, unknown>,
): string {
  const payload: CursorPayload = { customerId, key };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeCursor(cursor: string): CursorPayload {
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as unknown;

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as CursorPayload).customerId !== "string" ||
      typeof (parsed as CursorPayload).key !== "object" ||
      (parsed as CursorPayload).key === null ||
      Array.isArray((parsed as CursorPayload).key)
    ) {
      throw new Error("invalid cursor");
    }

    return parsed as CursorPayload;
  } catch {
    throw new ValidationError("invalid pagination cursor");
  }
}
