import { beforeEach, describe, expect, it, vi } from "vitest";

const { reconcile, retain, processInbox } = vi.hoisted(() => ({
  reconcile: vi.fn(),
  retain: vi.fn(),
  processInbox: vi.fn(),
}));

vi.mock("@/shared/infrastructure/composition-root", () => ({
  getStripeEventReconciler: () => ({ execute: reconcile }),
  getCommerceDataRetentionJob: () => ({ execute: retain }),
  getStripeInboxProcessor: () => ({ execute: processInbox }),
}));
vi.mock("@/shared/infrastructure/config/worker-config", () => ({
  loadCommerceWorkerSecret: () => "a-secure-worker-secret-with-32-chars",
}));
vi.mock("@/shared/infrastructure/observability/report-unexpected-error", () => ({
  reportUnexpectedError: vi.fn().mockReturnValue("test-error-id"),
}));

import { POST } from "./route";

describe("commerce reconciliation route", () => {
  beforeEach(() => {
    reconcile.mockReset();
    retain.mockReset();
    processInbox.mockReset();
  });

  it("rejects an unauthenticated invocation", async () => {
    const response = await POST(new Request(new URL("reconcile", import.meta.url), {
      method: "POST",
    }));

    expect(response.status).toBe(401);
    expect(reconcile).not.toHaveBeenCalled();
    expect(retain).not.toHaveBeenCalled();
    expect(processInbox).not.toHaveBeenCalled();
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
    const response = await POST(new Request(new URL("reconcile", import.meta.url), {
      method: "POST",
      headers: { authorization: "Bearer a-secure-worker-secret-with-32-chars" },
    }));

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
    });
  });

  it("returns a failure after completing the cycle when an event reaches the dead letter state", async () => {
    processInbox
      .mockResolvedValueOnce({ claimed: 1, processed: 0, retryScheduled: 0, failed: 1 })
      .mockResolvedValueOnce({ claimed: 0, processed: 0, retryScheduled: 0, failed: 0 });
    reconcile.mockResolvedValue({ checked: 0, relevant: 0, discovered: 0 });
    retain.mockResolvedValue({
      purchaseIntentsExpired: 0,
      webhookPayloadsPurged: 0,
      purchaseIntentPiiPurged: 0,
    });

    const response = await POST(new Request(new URL("reconcile", import.meta.url), {
      method: "POST",
      headers: { authorization: "Bearer a-secure-worker-secret-with-32-chars" },
    }));

    expect(response.status).toBe(500);
    expect(reconcile).toHaveBeenCalled();
    expect(retain).toHaveBeenCalled();
  });
});
