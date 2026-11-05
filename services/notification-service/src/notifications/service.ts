import type { Logger } from "../logger";
import type { OrderCreatedEvent } from "../events/orderCreated";
import type { NotificationRepository } from "./repository";
import type { NotificationChannel, NotificationRecord } from "./domain";
import type { NotificationSender } from "./sender";
import { renderOrderCreated } from "./template";

export class NotificationService {
  constructor(
    private readonly repository: NotificationRepository,
    private readonly sender: NotificationSender,
    private readonly logger: Logger,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async process(event: OrderCreatedEvent): Promise<void> {
    const channel: NotificationChannel = "email";
    const timestamp = this.now().toISOString();

    const record: NotificationRecord = {
      customerId: event.data.customerId,
      eventId: event.eventId,
      channel,
      type: event.eventType,
      status: "PENDING",
      orderId: event.data.orderId,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    const created = await this.repository.create(record);

    if (!created) {
      const existing = await this.repository.get(
        record.customerId,
        record.eventId,
        record.channel,
      );

      if (!existing) {
        throw new Error("notification record disappeared during deduplication");
      }

      if (existing.status === "SENT") {
        this.logger.info("notification already sent", {
          eventId: record.eventId,
          notificationId: `${record.customerId}:${record.eventId}:${record.channel}`,
        });
        return;
      }

      // PENDING or FAILED can be retried. Crashes can leave PENDING behind.
      this.logger.info("retrying notification", {
        eventId: record.eventId,
        previousStatus: existing.status,
      });
    }

    const message = renderOrderCreated(event);

    try {
      const result = await this.sender.send(message);
      await this.repository.markSent(record, result.providerMessageId);
    } catch (error) {
      const messageText =
        error instanceof Error ? error.message : String(error);

      try {
        await this.repository.markFailed(record, messageText);
      } catch (markError) {
        this.logger.error("failed to mark notification as failed", {
          eventId: record.eventId,
          error:
            markError instanceof Error
              ? markError.message
              : String(markError),
        });
      }

      throw error;
    }
  }
}
