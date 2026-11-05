import { randomUUID } from "node:crypto";

import type { Order, OrderItem } from "../orders/domain";

export interface OrderCreatedData {
  orderId: string;
  customerId: string;
  status: string;
  items: OrderItem[];
  totalCents: number;
  currency: string;
  createdAt: string;
}

export interface OrderCreatedEvent {
  eventId: string;
  eventType: "OrderCreated";
  eventVersion: 1;
  occurredAt: string;
  correlationId: string;
  data: OrderCreatedData;
}

export function buildOrderCreatedEvent(
  order: Order,
  correlationId?: string,
): OrderCreatedEvent {
  return {
    eventId: randomUUID(),
    eventType: "OrderCreated",
    eventVersion: 1,
    occurredAt: order.createdAt,
    correlationId: correlationId ?? randomUUID(),
    data: {
      orderId: order.orderId,
      customerId: order.customerId,
      status: order.status,
      items: order.items,
      totalCents: order.totalCents,
      currency: order.currency,
      createdAt: order.createdAt,
    },
  };
}
