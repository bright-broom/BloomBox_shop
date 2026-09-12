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
  it("uses a bounded configured batch for slow provider reads", async () => {
    const queue = { claim: vi.fn().mockResolvedValue([]), markProcessed: vi.fn(), markFailed: vi.fn() };
    await new ProcessProviderInbox(queue, { process: vi.fn() }, undefined, undefined, 1).execute();
    expect(queue.claim).toHaveBeenCalledWith(expect.objectContaining({ limit: 1 }));
    for (const size of [0, -1, 101, 1.5, NaN]) {
      expect(() => new ProcessProviderInbox(queue, { process: vi.fn() }, undefined, undefined, size)).toThrow(RangeError);
    }
  });

  it("claims and marks successfully processed events", async () => {
    const queue = {
      claim: vi.fn().mockResolvedValue([{ kind: "READABLE", event }]),
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
      claim: vi.fn().mockResolvedValue([{ kind: "READABLE", event }, { kind: "READABLE", event: second }]),
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

  it("never sends unreadable claims to the processor and includes them in failure counts", async () => {
    const reference = { provider: event.provider, providerAccountId: event.providerAccountId, externalEventId: "unreadable-1" };
    const secondReference = { ...reference, externalEventId: "unreadable-2" };
    const queue = {
      claim: vi.fn().mockResolvedValue([
        { kind: "UNREADABLE", reference }, { kind: "READABLE", event }, { kind: "UNREADABLE", reference: secondReference },
      ]),
      markProcessed: vi.fn(),
      markFailed: vi.fn().mockResolvedValueOnce("RETRY_SCHEDULED").mockResolvedValueOnce("FAILED"),
    };
    const processor = { process: vi.fn() };
    const now = new Date("2026-09-12T00:00:00Z");
    expect(await new ProcessProviderInbox(queue, processor, () => now, () => "worker").execute())
      .toEqual({ claimed: 3, processed: 1, retryScheduled: 1, failed: 1 });
    expect(processor.process).toHaveBeenCalledExactlyOnceWith(event);
    expect(queue.markProcessed).toHaveBeenCalledExactlyOnceWith(event, now, "worker");
    expect(queue.markFailed).toHaveBeenNthCalledWith(1, reference, "ProviderEventUnreadableError", now, "worker");
    expect(queue.markFailed).toHaveBeenNthCalledWith(2, secondReference, "ProviderEventUnreadableError", now, "worker");
  });

  it("propagates a failed retry write instead of reporting unreadable work as handled", async () => {
    const reference = { provider: event.provider, providerAccountId: event.providerAccountId, externalEventId: "unreadable" };
    const error = new Error("database unavailable");
    const queue = { claim: vi.fn().mockResolvedValue([{ kind: "UNREADABLE", reference }, { kind: "READABLE", event }]),
      markProcessed: vi.fn(), markFailed: vi.fn().mockRejectedValue(error) };
    const processor = { process: vi.fn() };
    await expect(new ProcessProviderInbox(queue, processor).execute()).rejects.toBe(error);
    expect(processor.process).not.toHaveBeenCalled();
    expect(queue.markProcessed).not.toHaveBeenCalled();
  });
});
