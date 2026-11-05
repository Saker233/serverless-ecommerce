import type { SQSBatchResponse, SQSEvent } from "aws-lambda";

import { loadConfig } from "./config";
import { createDocumentClient } from "./db";
import { parseOrderCreatedEvent } from "./events/orderCreated";
import { createLogger, type Logger } from "./logger";
import { DynamoNotificationRepository } from "./notifications/repository";
import { DryRunSender } from "./notifications/sender";
import { NotificationService } from "./notifications/service";

export function createHandler(
  service: NotificationService,
  logger: Logger,
) {
  return async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
    const batchItemFailures: Array<{ itemIdentifier: string }> = [];

    for (const record of event.Records) {
      try {
        const envelope = JSON.parse(record.body) as unknown;
        const payload = unwrapEventBridgeDetail(envelope);

        if (
          typeof payload !== "object" ||
          payload === null ||
          (payload as { eventType?: unknown }).eventType !== "OrderCreated"
        ) {
          logger.info("skipping unsupported event", {
            messageId: record.messageId,
          });
          continue;
        }

        const orderCreated = parseOrderCreatedEvent(payload);
        await service.process(orderCreated);

        logger.info("notification processed", {
          messageId: record.messageId,
          eventId: orderCreated.eventId,
          orderId: orderCreated.data.orderId,
        });
      } catch (error) {
        logger.error("notification processing failed", {
          messageId: record.messageId,
          error: error instanceof Error ? error.message : String(error),
        });
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    }

    return { batchItemFailures };
  };
}

function unwrapEventBridgeDetail(value: unknown): unknown {
  if (typeof value !== "object" || value === null) {
    return value;
  }

  const detail = (value as { detail?: unknown }).detail;
  if (detail === undefined) {
    return value;
  }

  if (typeof detail === "string") {
    try {
      return JSON.parse(detail) as unknown;
    } catch {
      return detail;
    }
  }

  return detail;
}

const config = loadConfig();
const logger = createLogger(config.logLevel);

if (!config.dryRun) {
  throw new Error(
    "SES sender is not implemented yet; set NOTIFICATION_DRY_RUN=true",
  );
}

const repository = new DynamoNotificationRepository(
  createDocumentClient(),
  config.notificationTable,
);
const sender = new DryRunSender(logger);
const service = new NotificationService(repository, sender, logger);

export const handler = createHandler(service, logger);
