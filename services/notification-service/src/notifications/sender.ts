import type { Logger } from "../logger";

export interface OutboundMessage {
  recipient: string;
  subject: string;
  text: string;
  html: string;
}

export interface SendResult {
  providerMessageId: string;
}

export interface NotificationSender {
  send(message: OutboundMessage): Promise<SendResult>;
}

export class DryRunSender implements NotificationSender {
  constructor(private readonly logger: Logger) {}

  async send(message: OutboundMessage): Promise<SendResult> {
    this.logger.info("notification dry run", {
      recipient: message.recipient,
      subject: message.subject,
    });

    return { providerMessageId: "dry-run" };
  }
}
