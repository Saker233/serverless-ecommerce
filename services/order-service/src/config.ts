import path from "node:path";

import { config as loadEnv } from "dotenv";

if (!process.env.AWS_LAMBDA_FUNCTION_NAME) {
  loadEnv({
    path: process.env.APP_ENV_FILE ?? path.resolve(__dirname, "../app.env"),
    quiet: true,
  });
}

export interface Config {
  env: string;
  serviceName: string;
  version: string;
  logLevel: string;
  port: number;
  ordersTable: string;
  eventBusName: string;
  productServiceUrl: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number(env.PORT ?? "8002");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be a valid TCP port, got ${env.PORT}`);
  }

  return {
    env: env.ENV ?? "dev",
    serviceName: env.SERVICE_NAME ?? "order-service",
    version: env.VERSION ?? "dev",
    logLevel: (env.LOG_LEVEL ?? "info").toLowerCase(),
    port,
    ordersTable: env.ORDERS_TABLE ?? "serverless-ecommerce-dev-orders",
    eventBusName: env.EVENT_BUS_NAME ?? "serverless-ecommerce-dev-events",
    productServiceUrl: env.PRODUCT_SERVICE_URL ?? "",
  };
}
