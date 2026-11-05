export type NotificationChannel = "email";
export type NotificationStatus = "PENDING" | "SENT" | "FAILED";

export interface NotificationRecord {
  customerId: string;
  eventId: string;
  channel: NotificationChannel;
  type: string;
  status: NotificationStatus;
  orderId: string;
  createdAt: string;
  updatedAt: string;
  providerMessageId?: string;
  error?: string;
}

export function notificationSortKey(
  eventId: string,
  channel: NotificationChannel,
): string {
  return `NOTIF#${eventId}#${channel}`;
}
