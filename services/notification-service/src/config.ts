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
  notificationTable: string;
  dryRun: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    env: env.ENV ?? "dev",
    serviceName: env.SERVICE_NAME ?? "notification-service",
    version: env.VERSION ?? "dev",
    logLevel: (env.LOG_LEVEL ?? "info").toLowerCase(),
    notificationTable:
      env.NOTIFICATION_TABLE ?? "serverless-ecommerce-dev-notifications",
    dryRun: (env.NOTIFICATION_DRY_RUN ?? "true").toLowerCase() !== "false",
  };
}
