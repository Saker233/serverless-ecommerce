export type OrderStatus = "PENDING" | "CONFIRMED" | "CANCELLED";

export interface OrderItem {
  productId: string;
  sku: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
  currency: string;
  productVersion?: number;
}

export interface Order {
  orderId: string;
  customerId: string;
  status: OrderStatus;
  items: OrderItem[];
  totalCents: number;
  currency: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateOrderItemInput {
  productId: string;
  sku: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
  currency: string;
  productVersion?: number;
}

export interface CreateOrderInput {
  items: CreateOrderItemInput[];
}

export interface NormalizedCreateOrder {
  items: OrderItem[];
  totalCents: number;
  currency: string;
}

export class ValidationError extends Error {
  readonly code = "validation_error";
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class OrderNotFoundError extends Error {
  readonly code = "not_found";
  readonly status = 404;

  constructor() {
    super("order not found");
    this.name = "OrderNotFoundError";
  }
}

export class IdempotencyConflictError extends Error {
  readonly code = "idempotency_conflict";
  readonly status = 409;

  constructor() {
    super("idempotency key was already used with a different request");
    this.name = "IdempotencyConflictError";
  }
}

export function normalizeIdempotencyKey(value: string | undefined): string {
  const key = (value ?? "").trim();
  if (!key) {
    throw new ValidationError("Idempotency-Key header is required");
  }

  if (key.length > 128) {
    throw new ValidationError("Idempotency-Key must be at most 128 characters");
  }

  for (const char of key) {
    const code = char.charCodeAt(0);
    if (code < 0x21 || code > 0x7e) {
      throw new ValidationError(
        "Idempotency-Key may contain only printable ASCII characters",
      );
    }
  }

  return key;
}

export function normalizeCreateOrder(input: unknown): NormalizedCreateOrder {
  if (!isRecord(input)) {
    throw new ValidationError("request body must be a JSON object");
  }

  const rawItems = input.items;
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new ValidationError("items must be a non-empty array");
  }

  if (rawItems.length > 50) {
    throw new ValidationError("items must contain at most 50 entries");
  }

  const items: OrderItem[] = [];
  let currency: string | null = null;
  let totalCents = 0;

  for (const rawItem of rawItems) {
    if (!isRecord(rawItem)) {
      throw new ValidationError("each item must be an object");
    }

    const productId = requiredString(rawItem, "productId", 128);
    const sku = requiredString(rawItem, "sku", 64);
    const name = requiredString(rawItem, "name", 200);
    const itemCurrency = requiredString(rawItem, "currency", 3).toUpperCase();
    if (!/^[A-Z]{3}$/.test(itemCurrency)) {
      throw new ValidationError("currency must be a 3-letter ISO code");
    }

    if (currency === null) {
      currency = itemCurrency;
    } else if (currency !== itemCurrency) {
      throw new ValidationError("all items must use the same currency");
    }

    const quantity = requiredInteger(rawItem, "quantity", 1, 100);
    const unitPriceCents = requiredInteger(
      rawItem,
      "unitPriceCents",
      1,
      Number.MAX_SAFE_INTEGER,
    );

    const lineTotal = quantity * unitPriceCents;
    if (!Number.isSafeInteger(lineTotal)) {
      throw new ValidationError("order total exceeds the safe integer range");
    }

    totalCents += lineTotal;
    if (!Number.isSafeInteger(totalCents)) {
      throw new ValidationError("order total exceeds the safe integer range");
    }

    const item: OrderItem = {
      productId,
      sku,
      name,
      quantity,
      unitPriceCents,
      currency: itemCurrency,
    };

    if (rawItem.productVersion !== undefined) {
      item.productVersion = requiredInteger(
        rawItem,
        "productVersion",
        1,
        Number.MAX_SAFE_INTEGER,
      );
    }

    items.push(item);
  }

  if (currency === null) {
    throw new ValidationError("at least one item is required");
  }

  return {
    items,
    totalCents,
    currency,
  };
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
    throw new ValidationError(`${field} must be a string`);
  }

  const value = raw.trim();
  if (!value) {
    throw new ValidationError(`${field} is required`);
  }

  if (value.length > maxLength) {
    throw new ValidationError(
      `${field} must be at most ${maxLength} characters`,
    );
  }

  return value;
}

function requiredInteger(
  record: Record<string, unknown>,
  field: string,
  min: number,
  max: number,
): number {
  const value = record[field];
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  ) {
    throw new ValidationError(
      `${field} must be an integer between ${min} and ${max}`,
    );
  }

  return value;
}
