/**
 * Transactional buyer notifications (ADR 0019). Pure rules: which events notify, how often to retry,
 * and how a plain-text message is composed from order facts. Recipients of a gift are never notified.
 */
export type NotificationKind = "ORDER_CONFIRMED" | "ORDER_SHIPPED";
export const NOTIFICATION_EVENT_TYPES = {
  "order.confirmed": "ORDER_CONFIRMED",
  "fulfillment.shipped": "ORDER_SHIPPED",
} as const satisfies Record<string, NotificationKind>;
export type NotificationEventType = keyof typeof NOTIFICATION_EVENT_TYPES;

export const NOTIFICATION_MAX_ATTEMPTS = 6;
/** Events older than this are left untouched, so enabling delivery never mails a backlog of old orders. */
export const NOTIFICATION_SEND_WINDOW_HOURS = 48;
export const NOTIFICATION_BATCH_LIMIT = 20;
export const NOTIFICATION_LEASE_SECONDS = 300;

export type ShippingCarrier = "YAMATO" | "SAGAWA" | "JAPAN_POST";

export type OrderNotificationFacts = Readonly<{
  displayId: string;
  productName: string;
  quantity: number;
  deliveryDate: string;
  totalYen: number;
}>;
export type ShipmentFacts = Readonly<{ carrier: ShippingCarrier; trackingNumber: string }>;

export type NotificationTemplate = Readonly<{ subject: string; body: readonly string[] }>;
export type NotificationCopy = Readonly<{
  orderConfirmed: NotificationTemplate;
  orderShipped: NotificationTemplate;
  carriers: Readonly<Record<ShippingCarrier, string>>;
  signature: readonly string[];
}>;
export type NotificationMessage = Readonly<{ subject: string; text: string }>;

export const NOTIFICATION_PLACEHOLDERS = [
  "displayId", "productName", "quantity", "deliveryDate", "total", "carrier", "trackingNumber", "accountUrl", "contactUrl",
] as const;
type Placeholder = (typeof NOTIFICATION_PLACEHOLDERS)[number];

/** Retry after 1, 2, 4, 8, 16 minutes, capped at one hour. */
export function notificationRetryDelaySeconds(attempts: number): number {
  return Math.min(60 * 2 ** Math.max(0, attempts - 1), 3_600);
}

export function unknownPlaceholders(template: string): string[] {
  return [...template.matchAll(/\{([A-Za-z]+)\}/g)]
    .map((match) => match[1] ?? "")
    .filter((name) => !(NOTIFICATION_PLACEHOLDERS as readonly string[]).includes(name));
}

function render(template: string, values: Readonly<Partial<Record<Placeholder, string>>>, singleLine: boolean): string {
  return template.replace(/\{([A-Za-z]+)\}/g, (whole, name: string) => {
    const value = values[name as Placeholder];
    if (value === undefined) throw new Error(`Missing notification value: ${name}`);
    // Order data is copied into mail headers and text; line breaks must never reach a header.
    return singleLine ? value.replace(/[\r\n]+/g, " ") : value.replace(/\r/g, "");
  });
}

function yen(amount: number): string {
  return `${new Intl.NumberFormat("ja-JP").format(amount)}円`;
}

export function composeNotification(
  kind: NotificationKind,
  order: OrderNotificationFacts,
  shipment: ShipmentFacts | null,
  copy: NotificationCopy,
  origin: string,
): NotificationMessage {
  const base = new URL(origin).origin;
  const values: Partial<Record<Placeholder, string>> = {
    displayId: order.displayId,
    productName: order.productName,
    quantity: String(order.quantity),
    deliveryDate: order.deliveryDate,
    total: yen(order.totalYen),
    accountUrl: `${base}/account`,
    contactUrl: `${base}/contact`,
  };
  if (kind === "ORDER_SHIPPED") {
    if (!shipment) throw new Error("Shipment facts are required");
    values.carrier = copy.carriers[shipment.carrier];
    values.trackingNumber = shipment.trackingNumber;
  }
  const template = kind === "ORDER_CONFIRMED" ? copy.orderConfirmed : copy.orderShipped;
  return {
    subject: render(template.subject, values, true),
    text: [...template.body, "", ...copy.signature].map((line) => render(line, values, false)).join("\n"),
  };
}
