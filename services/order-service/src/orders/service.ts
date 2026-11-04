import { createHash, randomUUID } from "node:crypto";

import {
  type CreateOrderResult,
  type ListOrdersResult,
  type OrderRepository,
} from "./repository";
import {
  normalizeCreateOrder,
  normalizeIdempotencyKey,
  type Order,
  OrderNotFoundError,
  type NormalizedCreateOrder,
} from "./domain";

const idempotencyTtlSeconds = 24 * 60 * 60;

export class OrderService {
  constructor(
    private readonly repository: OrderRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async create(
    customerId: string,
    input: unknown,
    idempotencyKey: string | undefined,
  ): Promise<CreateOrderResult> {
    const normalized = normalizeCreateOrder(input);
    const key = normalizeIdempotencyKey(idempotencyKey);
    const now = this.now();
    const timestamp = now.toISOString();

    const order: Order = {
      orderId: randomUUID(),
      customerId,
      status: "PENDING",
      items: normalized.items,
      totalCents: normalized.totalCents,
      currency: normalized.currency,
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    return this.repository.create(order, {
      idempotencyKey: key,
      requestHash: hashRequest(normalized),
      expiresAt: Math.floor(now.getTime() / 1000) + idempotencyTtlSeconds,
      createdAt: timestamp,
    });
  }

  async get(customerId: string, orderId: string): Promise<Order> {
    const order = await this.repository.get(orderId);
    if (!order || order.customerId !== customerId) {
      throw new OrderNotFoundError();
    }

    return order;
  }

  async list(
    customerId: string,
    limit: number,
    cursor?: string,
  ): Promise<ListOrdersResult> {
    return this.repository.listByCustomer(customerId, limit, cursor);
  }
}

function hashRequest(input: NormalizedCreateOrder): string {
  return createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex");
}
