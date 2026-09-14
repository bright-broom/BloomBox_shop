import { beforeEach, describe, expect, it, vi } from "vitest";

const { reconcile, retain, processInbox, recover } = vi.hoisted(() => ({
  reconcile: vi.fn(),
  retain: vi.fn(),
  processInbox: vi.fn(),
  recover: vi.fn(),
}));

vi.mock("@/shared/infrastructure/composition-root", () => ({
  getStripeEventReconciler: () => ({ execute: reconcile }),
  getCommerceDataRetentionJob: () => ({ execute: retain }),
  getStripeInboxProcessor: () => ({ execute: processInbox }),
  getStripeUnrecordedCheckoutRecovery: () => ({ execute: recover }),
}));
vi.mock("@/shared/infrastructure/config/worker-config", () => ({
  loadCommerceWorkerSecret: () => "a-secure-worker-secret-with-32-chars",
}));
vi.mock("@/shared/infrastructure/observability/report-unexpected-error", () => ({
  reportUnexpectedError: vi.fn().mockReturnValue("test-error-id"),
}));

import { POST } from "./route";

function authenticated() {
  return new Request(new URL("reconcile", import.meta.url), {
    method: "POST",
    headers: { authorization: "Bearer a-secure-worker-secret-with-32-chars" },
  });
}
function quietCycle() {
  processInbox.mockResolvedValue({ claimed: 0, processed: 0, retryScheduled: 0, failed: 0 });
  reconcile.mockResolvedValue({ checked: 0, relevant: 0, discovered: 0 });
  retain.mockResolvedValue({ purchaseIntentsExpired: 0, webhookPayloadsPurged: 0, purchaseIntentPiiPurged: 0 });
  recover.mockResolvedValue({ checked: 0, released: 0, heldForReview: 0 });
}

describe("commerce reconciliation route", () => {
  beforeEach(() => {
    reconcile.mockReset();
    retain.mockReset();
    processInbox.mockReset();
    recover.mockReset();
  });

  it("rejects an unauthenticated invocation", async () => {
    const response = await POST(new Request(new URL("reconcile", import.meta.url), {
      method: "POST",
    }));

    expect(response.status).toBe(401);
    expect(reconcile).not.toHaveBeenCalled();
    expect(retain).not.toHaveBeenCalled();
    expect(processInbox).not.toHaveBeenCalled();
    expect(recover).not.toHaveBeenCalled();
  });

  it("runs bounded reconciliation for an authenticated invocation", async () => {
    processInbox
      .mockResolvedValueOnce({ claimed: 2, processed: 1, retryScheduled: 1, failed: 0 })
      .mockResolvedValueOnce({ claimed: 1, processed: 1, retryScheduled: 0, failed: 0 });
    reconcile.mockResolvedValue({ checked: 4, relevant: 2, discovered: 1 });
    retain.mockResolvedValue({
      purchaseIntentsExpired: 2,
      webhookPayloadsPurged: 3,
      purchaseIntentPiiPurged: 1,
    });
    recover.mockResolvedValue({ checked: 2, released: 2, heldForReview: 0 });
    const response = await POST(authenticated());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      inbox: { claimed: 3, processed: 2, retryScheduled: 1, failed: 0 },
      reconciliation: { checked: 4, relevant: 2, discovered: 1 },
      retention: {
        purchaseIntentsExpired: 2,
        webhookPayloadsPurged: 3,
        purchaseIntentPiiPurged: 1,
      },
      unrecordedCheckouts: { checked: 2, released: 2, heldForReview: 0 },
    });
  });

  it("settles unrecorded checkouts only after verified events were drained", async () => {
    quietCycle();
    const order: string[] = [];
    processInbox.mockImplementation(async () => { order.push("inbox"); return { claimed: 0, processed: 0, retryScheduled: 0, failed: 0 }; });
    reconcile.mockImplementation(async () => { order.push("events"); return { checked: 0, relevant: 0, discovered: 0 }; });
    recover.mockImplementation(async () => { order.push("unrecorded"); return { checked: 0, released: 0, heldForReview: 0 }; });

    expect((await POST(authenticated())).status).toBe(200);
    expect(order).toEqual(["inbox", "events", "inbox", "unrecorded"]);
  });

  it("returns a failure after completing the cycle when an event reaches the dead letter state", async () => {
    quietCycle();
    processInbox
      .mockResolvedValueOnce({ claimed: 1, processed: 0, retryScheduled: 0, failed: 1 })
      .mockResolvedValueOnce({ claimed: 0, processed: 0, retryScheduled: 0, failed: 0 });

    const response = await POST(authenticated());

    expect(response.status).toBe(500);
    expect(reconcile).toHaveBeenCalled();
    expect(retain).toHaveBeenCalled();
    expect(recover).toHaveBeenCalled();
  });

  it("fails the run so an unrecorded checkout that must not be released is investigated", async () => {
    quietCycle();
    recover.mockResolvedValue({ checked: 1, released: 0, heldForReview: 1 });

    const response = await POST(authenticated());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false });
  });
});
