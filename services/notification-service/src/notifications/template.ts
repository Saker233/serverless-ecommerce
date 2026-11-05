import type { OrderCreatedEvent } from "../events/orderCreated";
import type { OutboundMessage } from "./sender";

export function renderOrderCreated(event: OrderCreatedEvent): OutboundMessage {
  const total = (event.data.totalCents / 100).toFixed(2);
  const itemCount = event.data.items.length;
  const orderId = escapeHtml(event.data.orderId);
  const currency = escapeHtml(event.data.currency);

  return {
    recipient: event.data.customerId,
    subject: `We received your order ${event.data.orderId}`,
    text:
      `We received your order ${event.data.orderId}.\n\n` +
      `Items: ${itemCount}\n` +
      `Total: ${total} ${event.data.currency}\n\n` +
      "We will send another notification when your order status changes.",
    html:
      "<p>We received your order.</p>" +
      `<p><strong>Order:</strong> ${orderId}</p>` +
      `<p><strong>Items:</strong> ${itemCount}</p>` +
      `<p><strong>Total:</strong> ${total} ${currency}</p>` +
      "<p>We will send another notification when your order status changes.</p>",
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
