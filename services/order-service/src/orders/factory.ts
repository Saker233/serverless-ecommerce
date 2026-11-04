import type { Config } from "../config";
import { createDocumentClient } from "../db";
import { DynamoOrderRepository } from "./repository";
import { OrderService } from "./service";

export function createOrderService(config: Config): OrderService {
  return new OrderService(
    new DynamoOrderRepository(createDocumentClient(), config.ordersTable),
  );
}
