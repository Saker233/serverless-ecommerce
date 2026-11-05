import type { OrderCreatedEvent } from "../../src/events/orderCreated";
import {
  IdempotencyConflictError,
  type Order,
} from "../../src/orders/domain";
import type {
  CreateOrderPersistence,
  CreateOrderResult,
  ListOrdersResult,
  OrderRepository,
} from "../../src/orders/repository";

export class InMemoryOrderRepository implements OrderRepository {
  private readonly orders = new Map<string, Order>();
  private readonly idempotency = new Map<
    string,
    { orderId: string; requestHash: string }
  >();
  readonly outboxEvents: OrderCreatedEvent[] = [];

  async create(
    order: Order,
    idempotency: CreateOrderPersistence,
    event: OrderCreatedEvent,
  ): Promise<CreateOrderResult> {
    const key = `${order.customerId}:${idempotency.idempotencyKey}`;
    const existing = this.idempotency.get(key);

    if (existing) {
      if (existing.requestHash !== idempotency.requestHash) {
        throw new IdempotencyConflictError();
      }

      const existingOrder = this.orders.get(existing.orderId);
      if (!existingOrder) {
        throw new Error("idempotency record points to a missing order");
      }

      return { order: existingOrder, created: false };
    }

    this.orders.set(order.orderId, order);
    this.idempotency.set(key, {
      orderId: order.orderId,
      requestHash: idempotency.requestHash,
    });
    this.outboxEvents.push(event);

    return { order, created: true };
  }

  async get(orderId: string): Promise<Order | null> {
    return this.orders.get(orderId) ?? null;
  }

  async listByCustomer(
    customerId: string,
    limit: number,
    cursor?: string,
  ): Promise<ListOrdersResult> {
    const all = [...this.orders.values()]
      .filter((order) => order.customerId === customerId)
      .sort((a, b) => {
        const byCreatedAt = b.createdAt.localeCompare(a.createdAt);
        return byCreatedAt !== 0
          ? byCreatedAt
          : b.orderId.localeCompare(a.orderId);
      });

    let start = 0;
    if (cursor) {
      const index = all.findIndex((order) => order.orderId === cursor);
      start = index >= 0 ? index + 1 : 0;
    }

    const page = all.slice(start, start + limit);
    const nextCursor =
      start + limit < all.length
        ? page[page.length - 1]?.orderId
        : undefined;

    return { orders: page, nextCursor };
  }
}
