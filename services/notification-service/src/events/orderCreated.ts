export interface OrderCreatedItem {
  productId: string;
  quantity: number;
}

export interface OrderCreatedEvent {
  eventId: string;
  eventType: "OrderCreated";
  eventVersion: number;
  occurredAt: string;
  correlationId: string;
  data: {
    orderId: string;
    customerId: string;
    status: string;
    items: OrderCreatedItem[];
    totalCents: number;
    currency: string;
    createdAt: string;
  };
}

export class InvalidEventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidEventError";
  }
}

export function parseOrderCreatedEvent(payload: unknown): OrderCreatedEvent {
  if (!isRecord(payload)) {
    throw new InvalidEventError("event must be a JSON object");
  }

  if (payload.eventType !== "OrderCreated") {
    throw new InvalidEventError("unsupported event type");
  }

  const eventId = requiredString(payload, "eventId", 128);
  const occurredAt = requiredString(payload, "occurredAt", 64);
  const correlationId = requiredString(payload, "correlationId", 128);
  const eventVersion = requiredInteger(payload, "eventVersion", 1);

  if (!isRecord(payload.data)) {
    throw new InvalidEventError("event data must be an object");
  }

  const orderId = requiredString(payload.data, "orderId", 128);
  const customerId = requiredString(payload.data, "customerId", 128);
  const status = requiredString(payload.data, "status", 32);
  const currency = requiredString(payload.data, "currency", 3).toUpperCase();
  const createdAt = requiredString(payload.data, "createdAt", 64);
  const totalCents = requiredInteger(payload.data, "totalCents", 0);

  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new InvalidEventError("currency must be a 3-letter ISO code");
  }

  const items = parseItems(payload.data.items);

  return {
    eventId,
    eventType: "OrderCreated",
    eventVersion,
    occurredAt,
    correlationId,
    data: {
      orderId,
      customerId,
      status,
      items,
      totalCents,
      currency,
      createdAt,
    },
  };
}

function parseItems(value: unknown): OrderCreatedItem[] {
  if (!Array.isArray(value)) {
    throw new InvalidEventError("items must be an array");
  }

  return value.map((item) => {
    if (!isRecord(item)) {
      throw new InvalidEventError("each item must be an object");
    }

    return {
      productId: requiredString(item, "productId", 128),
      quantity: requiredInteger(item, "quantity", 1),
    };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(
  record: Record<string, unknown>,
  field: string,
  maxLength: number,
): string {
  const raw = record[field];
  if (typeof raw !== "string") {
    throw new InvalidEventError(`${field} must be a string`);
  }

  const value = raw.trim();
  if (!value || value.length > maxLength) {
    throw new InvalidEventError(`${field} is invalid`);
  }

  return value;
}

function requiredInteger(
  record: Record<string, unknown>,
  field: string,
  min: number,
): number {
  const value = record[field];
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < min
  ) {
    throw new InvalidEventError(`${field} must be an integer >= ${min}`);
  }

  return value;
}
