import { describe, expect, it, vi } from "vitest";
import {
  ReceiveProviderWebhook,
  type VerifiedProviderEvent,
} from "./receive-provider-webhook";

const event: VerifiedProviderEvent = {
  provider: "STRIPE",
  providerAccountId: "acct_example",
  externalEventId: "evt_123",
  eventType: "checkout.session.completed",
  externalObjectId: "cs_test_123",
  apiVersion: "2026-07-29.dahlia",
  occurredAt: new Date("2026-08-21T00:00:00.000Z"),
  payload: {},
};

describe("ReceiveProviderWebhook", () => {
  it("acknowledges a duplicate after durable deduplication without running business work", async () => {
    const verifier = { verify: vi.fn().mockReturnValue(event) };
    const inbox = {
      record: vi.fn().mockResolvedValue("DUPLICATE" as const),
    };
    const receiver = new ReceiveProviderWebhook(verifier, inbox);

    await expect(receiver.execute("raw", "signature")).resolves.toBe("DUPLICATE");
    expect(inbox.record).toHaveBeenCalledWith(event);
  });

  it("does not acknowledge an event that could not be persisted", async () => {
    const verifier = { verify: vi.fn().mockReturnValue(event) };
    const error = new Error("database unavailable");
    const inbox = { record: vi.fn().mockRejectedValue(error) };
    const receiver = new ReceiveProviderWebhook(verifier, inbox);

    await expect(receiver.execute("raw", "signature")).rejects.toBe(error);
  });

  it("ignores signed event types outside the required subscription", async () => {
    const verifier = { verify: vi.fn().mockReturnValue(null) };
    const inbox = {
      record: vi.fn(),
    };

    await expect(new ReceiveProviderWebhook(verifier, inbox).execute("raw", "signature"))
      .resolves.toBe("IGNORED");
    expect(inbox.record).not.toHaveBeenCalled();
  });
});
