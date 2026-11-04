import { createApp } from "./app";
import { loadConfig } from "./config";
import { createLogger } from "./logger";

const config = loadConfig();
const logger = createLogger(config.logLevel);
const app = createApp(config, logger);

const server = app.listen(config.port, () => {
  logger.info("order service listening", {
    port: config.port,
    environment: config.env,
  });
});

function shutdown(signal: string): void {
  logger.info("shutting down", { signal });

  server.close((error) => {
    if (error) {
      logger.error("shutdown failed", { error: error.message });
      process.exitCode = 1;
      return;
    }

    process.exitCode = 0;
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
