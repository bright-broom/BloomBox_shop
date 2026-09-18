import { describe, expect, it } from "vitest";
import { notificationContent, notificationContentSchema } from "./notification-content";

describe("notification content", () => {
  it("validates the checked-in copy and never mentions gift messages or recipient details", () => {
    expect(notificationContent.orderConfirmed.subject).toContain("{displayId}");
    const all = JSON.stringify(notificationContent);
    expect(all).not.toMatch(/\{(recipient|giftMessage|address|email|phone)/i);
  });

  it("rejects unknown placeholders so personal fields cannot be added by copy edits alone", () => {
    const broken = { ...notificationContent, orderShipped: { ...notificationContent.orderShipped, body: ["{recipientName}"] } };
    expect(notificationContentSchema.safeParse(broken).success).toBe(false);
  });
});
