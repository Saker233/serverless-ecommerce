import express from "express";

import { loadConfig, type Config } from "./config";
import { createLogger, type Logger } from "./logger";
import { correlation } from "./middleware/correlation";
import { errorHandler, notFound } from "./middleware/error";
import { healthRouter } from "./routes/health";

export function createApp(
  config: Config = loadConfig(),
  logger: Logger = createLogger(config.logLevel),
) {
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", true);

  app.use(correlation(logger));
  app.use(express.json({ limit: "1mb" }));
  app.use(healthRouter(config));

  app.use(notFound);
  app.use(errorHandler(logger));

  return app;
}
