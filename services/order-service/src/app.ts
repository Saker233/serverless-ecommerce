import express from "express";

import { loadConfig, type Config } from "./config";
import { createLogger, type Logger } from "./logger";
import { correlation } from "./middleware/correlation";
import { errorHandler, notFound } from "./middleware/error";
import { createOrderService } from "./orders/factory";
import type { OrderService } from "./orders/service";
import { healthRouter } from "./routes/health";
import { ordersRouter } from "./routes/orders";

export interface AppDependencies {
  orders?: OrderService;
}

export function createApp(
  config: Config = loadConfig(),
  logger: Logger = createLogger(config.logLevel),
  dependencies: AppDependencies = {},
) {
  const app = express();
  const orders = dependencies.orders ?? createOrderService(config);

  app.disable("x-powered-by");
  app.set("trust proxy", true);

  app.use(correlation(logger));
  app.use(express.json({ limit: "1mb" }));
  app.use(healthRouter(config));
  app.use(ordersRouter(orders));

  app.use(notFound);
  app.use(errorHandler(logger));

  return app;
}
