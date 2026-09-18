import { describe, expect, it } from "vitest";
import { composeNotification, notificationRetryDelaySeconds, unknownPlaceholders, type NotificationCopy } from "./notification";

const copy: NotificationCopy = {
  orderConfirmed: { subject: "ご注文 {displayId}", body: ["{productName} × {quantity}", "{deliveryDate} / {total}", "{accountUrl}"] },
  orderShipped: { subject: "発送 {displayId}", body: ["{carrier} {trackingNumber}"] },
  carriers: { YAMATO: "ヤマト運輸", SAGAWA: "佐川急便", JAPAN_POST: "日本郵便" },
  signature: ["{contactUrl}"],
};
const order = { displayId: "BB-1", productName: "BLOOM BOX M", quantity: 1, deliveryDate: "2026-10-01", totalYen: 5000 };

describe("composeNotification", () => {
  it("fills order facts, yen totals and site links into a plain-text confirmation", () => {
    expect(composeNotification("ORDER_CONFIRMED", order, null, copy, "https://shop.example/any?x=1")).toEqual({
      subject: "ご注文 BB-1",
      text: "BLOOM BOX M × 1\n2026-10-01 / 5,000円\nhttps://shop.example/account\n\nhttps://shop.example/contact",
    });
  });

  it("adds the carrier name and tracking number to the shipping notice", () => {
    expect(composeNotification("ORDER_SHIPPED", order, { carrier: "JAPAN_POST", trackingNumber: "AB123456CD" }, copy, "https://shop.example").text)
      .toContain("日本郵便 AB123456CD");
    expect(() => composeNotification("ORDER_SHIPPED", order, null, copy, "https://shop.example")).toThrow();
  });

  it("never lets order data break the subject line", () => {
    const message = composeNotification("ORDER_CONFIRMED", { ...order, displayId: "BB-1\r\nBcc: x@example.test" }, null, copy, "https://shop.example");
    expect(message.subject).not.toMatch(/[\r\n]/);
  });

  it("rejects unknown placeholders and missing values", () => {
    expect(unknownPlaceholders("{displayId} {recipientName} {giftMessage}")).toEqual(["recipientName", "giftMessage"]);
    expect(() => composeNotification("ORDER_CONFIRMED", order, null, { ...copy, orderConfirmed: { subject: "{carrier}", body: [] } }, "https://shop.example")).toThrow();
  });
});

describe("notificationRetryDelaySeconds", () => {
  it("backs off from one minute to at most one hour", () => {
    expect([1, 2, 3, 4, 5, 6, 12].map(notificationRetryDelaySeconds)).toEqual([60, 120, 240, 480, 960, 1920, 3600]);
  });
});
