import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NotificationCopy } from "../domain/notification";
import { DeliverNotifications, EmailRejectedError, type ClaimedNotification, type NotificationQueue, type OutgoingEmail } from "./deliver-notifications";

const copy: NotificationCopy = {
  orderConfirmed: { subject: "ご注文 {displayId}", body: ["{productName}"] },
  orderShipped: { subject: "発送 {displayId}", body: ["{carrier} {trackingNumber}"] },
  requestReplied: { subject: "回答 {displayId}", body: ["{supportUrl}"] },
  carriers: { YAMATO: "ヤマト運輸", SAGAWA: "佐川急便", JAPAN_POST: "日本郵便" },
  signature: ["BLOOM BOX"],
};
const claimed = (attempts = 1, kind: ClaimedNotification["kind"] = "ORDER_CONFIRMED"): ClaimedNotification => ({
  eventId: "11111111-1111-4111-8111-111111111111", lease: "lease", kind, attempts,
  orderId: "22222222-2222-4222-8222-222222222222",
  requestId: kind === "REQUEST_REPLIED" ? "33333333-3333-4333-8333-333333333333" : null,
  shipment: kind === "ORDER_SHIPPED" ? { carrier: "YAMATO", trackingNumber: "123456789012" } : null,
});
const facts = { email: "buyer@example.test", order: { displayId: "BB-1", productName: "BLOOM BOX M", quantity: 1, deliveryDate: "2026-10-01", totalYen: 5000 } };

let queue: { [K in keyof NotificationQueue]: ReturnType<typeof vi.fn> };
let send: ReturnType<typeof vi.fn<(email: OutgoingEmail) => Promise<string>>>;
let report: ReturnType<typeof vi.fn<(error: unknown) => void>>;
function useCase() {
  return new DeliverNotifications(queue as unknown as NotificationQueue, { send }, copy, "https://shop.example", report);
}
beforeEach(() => {
  queue = { claim: vi.fn(), facts: vi.fn().mockResolvedValue(facts), complete: vi.fn(), retry: vi.fn(), fail: vi.fn() };
  send = vi.fn<(email: OutgoingEmail) => Promise<string>>().mockResolvedValue("msg_1");
  report = vi.fn<(error: unknown) => void>();
});

describe("DeliverNotifications", () => {
  it("sends the buyer's notice with the outbox event as idempotency key and records it", async () => {
    queue.claim.mockResolvedValue([claimed(1, "ORDER_SHIPPED")]);
    expect(await useCase().execute()).toEqual({ sent: 1, retried: 0, failed: 0, skipped: 0 });
    expect(send).toHaveBeenCalledWith({ to: "buyer@example.test", subject: "発送 BB-1", text: "ヤマト運輸 123456789012\n\nBLOOM BOX",
      idempotencyKey: "11111111-1111-4111-8111-111111111111" });
    expect(queue.complete).toHaveBeenCalledWith(claimed(1, "ORDER_SHIPPED"), "msg_1");
  });

  it("skips permanently without sending when there is no buyer email or the order is no longer active", async () => {
    queue.claim.mockResolvedValue([claimed(), claimed(), claimed(1, "REQUEST_REPLIED")]);
    queue.facts.mockResolvedValueOnce("NO_BUYER_EMAIL").mockResolvedValueOnce("ORDER_NOT_ACTIVE").mockResolvedValueOnce("REQUEST_NOT_ANSWERED");
    expect(await useCase().execute()).toEqual({ sent: 0, retried: 0, failed: 0, skipped: 3 });
    expect(send).not.toHaveBeenCalled();
    expect(queue.fail.mock.calls.map((call) => call[1])).toEqual(["NO_BUYER_EMAIL", "ORDER_NOT_ACTIVE", "REQUEST_NOT_ANSWERED"]);
  });

  it("tells the buyer an answer is waiting without putting it in the mail", async () => {
    queue.claim.mockResolvedValue([claimed(1, "REQUEST_REPLIED")]);
    expect(await useCase().execute()).toEqual({ sent: 1, retried: 0, failed: 0, skipped: 0 });
    expect(send).toHaveBeenCalledWith({ to: "buyer@example.test", subject: "回答 BB-1",
      text: "https://shop.example/account/support\n\nBLOOM BOX", idempotencyKey: "11111111-1111-4111-8111-111111111111" });
  });

  it("retries a transient failure with backoff and gives up after the attempt limit", async () => {
    queue.claim.mockResolvedValue([claimed(2), claimed(6)]);
    send.mockRejectedValue(new Error("timeout"));
    expect(await useCase().execute()).toEqual({ sent: 0, retried: 1, failed: 1, skipped: 0 });
    expect(queue.retry).toHaveBeenCalledWith(claimed(2), "SEND_FAILED", 120);
    expect(queue.fail).toHaveBeenCalledWith(claimed(6), "RETRY_EXHAUSTED");
    expect(report).toHaveBeenCalledTimes(2);
  });

  it("does not retry a message the provider rejected, and keeps going with the batch", async () => {
    queue.claim.mockResolvedValue([claimed(), claimed()]);
    send.mockRejectedValueOnce(new EmailRejectedError()).mockResolvedValueOnce("msg_2");
    expect(await useCase().execute()).toEqual({ sent: 1, retried: 0, failed: 1, skipped: 0 });
    expect(queue.fail).toHaveBeenCalledWith(claimed(), "REJECTED");
    expect(report).not.toHaveBeenCalled();
  });

  it("retries when order facts cannot be read, for example during a key rotation", async () => {
    queue.claim.mockResolvedValue([claimed()]);
    queue.facts.mockRejectedValue(new Error("key unavailable"));
    expect(await useCase().execute()).toEqual({ sent: 0, retried: 1, failed: 0, skipped: 0 });
    expect(send).not.toHaveBeenCalled();
  });
});
