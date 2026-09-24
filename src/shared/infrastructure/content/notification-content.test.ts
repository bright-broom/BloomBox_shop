import { describe, expect, it } from "vitest";
import { notificationContent, notificationContentSchema } from "./notification-content";

describe("notification content", () => {
  it("validates the checked-in copy and never mentions gift messages or recipient details", () => {
    expect(notificationContent.orderConfirmed.subject).toContain("{displayId}");
    const all = JSON.stringify(notificationContent);
    expect(all).not.toMatch(/\{(recipient|giftMessage|address|email|phone)/i);
  });

  it("keeps the reply notice free of order details, and points to the answer instead of quoting it", () => {
    const reply = JSON.stringify(notificationContent.requestReplied);
    expect(reply).toContain("{supportUrl}");
    for (const forbidden of ["{productName}", "{deliveryDate}", "{total}", "{quantity}", "{trackingNumber}"]) expect(reply).not.toContain(forbidden);
    // A copy edit cannot start carrying the gift's details into mail (ADR 0021).
    for (const body of [["{productName}"], ["{deliveryDate}"], ["{total}"]]) {
      expect(notificationContentSchema.safeParse({ ...notificationContent, requestReplied: { ...notificationContent.requestReplied, body } }).success).toBe(false);
    }
    expect(notificationContentSchema.safeParse({ ...notificationContent, requestReplied: { subject: "回答 {total}", body: ["{supportUrl}"] } }).success).toBe(false);
  });

  it("rejects unknown placeholders so personal fields cannot be added by copy edits alone", () => {
    const broken = { ...notificationContent, orderShipped: { ...notificationContent.orderShipped, body: ["{recipientName}"] } };
    expect(notificationContentSchema.safeParse(broken).success).toBe(false);
  });
});
