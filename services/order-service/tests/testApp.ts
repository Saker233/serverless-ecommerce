import { createApp } from "../src/app";
import { loadConfig } from "../src/config";
import { createLogger } from "../src/logger";
import { OrderService } from "../src/orders/service";
import { InMemoryOrderRepository } from "./helpers/inMemoryOrderRepository";

export function buildTestApp() {
  const repository = new InMemoryOrderRepository();
  const orders = new OrderService(
    repository,
    () => new Date("2026-01-01T00:00:00.000Z"),
  );
  const config = loadConfig({
    ENV: "test",
    SERVICE_NAME: "order-service",
    VERSION: "test",
    LOG_LEVEL: "error",
    PORT: "8002",
    ORDERS_TABLE: "test-orders",
  });

  return {
    app: createApp(config, createLogger("error"), { orders }),
    repository,
    orders,
  };
}

export function authHeaders(
  sub = "user-1",
  tokenUse = "access",
): Record<string, string> {
  return {
    "x-auth-sub": sub,
    "x-auth-token-use": tokenUse,
  };
}
