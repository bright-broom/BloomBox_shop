import { describe, expect, it, vi } from "vitest";
import type { VerifiedProviderEvent } from "./receive-provider-webhook";
import { ProcessProviderInbox } from "./process-provider-inbox";

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

describe("ProcessProviderInbox", () => {
  it("claims and marks successfully processed events", async () => {
    const queue = {
      claim: vi.fn().mockResolvedValue([event]),
      markProcessed: vi.fn().mockResolvedValue(undefined),
      markFailed: vi.fn(),
    };
    const processor = { process: vi.fn().mockResolvedValue(undefined) };
    const now = new Date("2026-08-21T00:01:00.000Z");

    await expect(new ProcessProviderInbox(queue, processor, () => now, () => "worker-1").execute())
      .resolves.toEqual({ claimed: 1, processed: 1, retryScheduled: 0, failed: 0 });
    expect(queue.markProcessed).toHaveBeenCalledWith(event, now, "worker-1");
    expect(queue.markFailed).not.toHaveBeenCalled();
  });

  it("continues the batch and records retry versus terminal failure", async () => {
    const second = { ...event, externalEventId: "evt_456" };
    const queue = {
      claim: vi.fn().mockResolvedValue([event, second]),
      markProcessed: vi.fn(),
      markFailed: vi.fn()
        .mockResolvedValueOnce("RETRY_SCHEDULED")
        .mockResolvedValueOnce("FAILED"),
    };
    const dependencyError = new Error("dependency missing");
    dependencyError.name = "ProviderDependencyError";
    const processor = { process: vi.fn().mockRejectedValue(dependencyError) };
    const now = new Date("2026-08-21T00:01:00.000Z");

    await expect(new ProcessProviderInbox(queue, processor, () => now, () => "worker-1").execute())
      .resolves.toEqual({ claimed: 2, processed: 0, retryScheduled: 1, failed: 1 });
    expect(queue.markFailed).toHaveBeenNthCalledWith(
      1,
      event,
      "ProviderDependencyError",
      now,
      "worker-1",
    );
    expect(queue.markFailed).toHaveBeenCalledTimes(2);
  });
});
