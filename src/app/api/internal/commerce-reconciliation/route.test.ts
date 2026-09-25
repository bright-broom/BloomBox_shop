import { beforeEach, describe, expect, it, vi } from "vitest";

const { reconcile, retain, processInbox, recover, attention, deliver, undelivered, reportUnexpectedError } = vi.hoisted(() => ({
  reconcile: vi.fn(),
  retain: vi.fn(),
  processInbox: vi.fn(),
  recover: vi.fn(),
  attention: vi.fn(),
  deliver: vi.fn(),
  undelivered: vi.fn(),
  reportUnexpectedError: vi.fn().mockReturnValue("test-error-id"),
}));

vi.mock("@/shared/infrastructure/composition-root", () => ({
  getStripeEventReconciler: () => ({ execute: reconcile }),
  getCommerceDataRetentionJob: () => ({ execute: retain }),
  getStripeInboxProcessor: () => ({ execute: processInbox }),
  getStripeUnrecordedCheckoutRecovery: () => ({ execute: recover }),
  getCommerceWorkerAttention: () => ({ execute: attention }),
}));
vi.mock("@/shared/infrastructure/config/worker-config", () => ({
  loadCommerceWorkerSecret: () => "a-secure-worker-secret-with-32-chars",
}));
vi.mock("@/shared/infrastructure/observability/report-unexpected-error", () => ({ reportUnexpectedError }));
vi.mock("@/shared/infrastructure/notification-runtime", () => ({
  deliverBuyerNotifications: deliver,
  countUndeliveredBuyerNotifications: undelivered,
}));

import { POST } from "./route";

const healthy = { failedInboxEvents: 0, unrecordedCheckoutsAwaitingReview: 0, requiresAttention: false };
const healthyResponse = { ...healthy, undeliveredNotifications: 0, notificationDeliveryUnavailable: false };

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
  attention.mockResolvedValue(healthy);
  deliver.mockResolvedValue({ disabled: true });
  undelivered.mockResolvedValue(0);
}

describe("commerce reconciliation route", () => {
  beforeEach(() => {
    for (const mock of [reconcile, retain, processInbox, recover, attention, deliver, undelivered]) mock.mockReset();
    reportUnexpectedError.mockClear();
  });

  it("rejects an unauthenticated invocation", async () => {
    const response = await POST(new Request(new URL("reconcile", import.meta.url), {
      method: "POST",
    }));

    expect(response.status).toBe(401);
    for (const mock of [reconcile, retain, processInbox, recover, attention, deliver, undelivered]) expect(mock).not.toHaveBeenCalled();
  });

  it("runs bounded reconciliation for an authenticated invocation", async () => {
    quietCycle();
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
      notifications: { disabled: true },
      attention: healthyResponse,
    });
  });

  it("checks unresolved conditions only after the whole cycle has run", async () => {
    quietCycle();
    const order: string[] = [];
    processInbox.mockImplementation(async () => { order.push("inbox"); return { claimed: 0, processed: 0, retryScheduled: 0, failed: 0 }; });
    reconcile.mockImplementation(async () => { order.push("events"); return { checked: 0, relevant: 0, discovered: 0 }; });
    retain.mockImplementation(async () => { order.push("retention"); return { purchaseIntentsExpired: 0, webhookPayloadsPurged: 0, purchaseIntentPiiPurged: 0 }; });
    recover.mockImplementation(async () => { order.push("unrecorded"); return { checked: 0, released: 0, heldForReview: 0 }; });
    deliver.mockImplementation(async () => { order.push("notifications"); return { disabled: true }; });
    attention.mockImplementation(async () => { order.push("attention"); return healthy; });
    undelivered.mockImplementation(async () => { order.push("undelivered"); return 0; });

    expect((await POST(authenticated())).status).toBe(200);
    expect(order).toEqual(["inbox", "events", "inbox", "retention", "unrecorded", "notifications", "attention", "undelivered"]);
  });

  it.each([
    { name: "a dead-lettered event from an earlier run", attention: { failedInboxEvents: 1, unrecordedCheckoutsAwaitingReview: 0, requiresAttention: true } },
    { name: "an unrecorded checkout still awaiting review", attention: { failedInboxEvents: 0, unrecordedCheckoutsAwaitingReview: 1, requiresAttention: true } },
  ])("keeps failing while $name remains unresolved, even when this run found nothing new", async ({ attention: unresolved }) => {
    quietCycle();
    attention.mockResolvedValue(unresolved);

    const response = await POST(authenticated());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      ok: false,
      attention: { ...unresolved, undeliveredNotifications: 0, notificationDeliveryUnavailable: false },
    });
    expect(reportUnexpectedError).not.toHaveBeenCalled();
    expect(recover).toHaveBeenCalled();
  });

  it("keeps failing while a buyer notification will not be delivered, after all commerce work has run", async () => {
    quietCycle();
    deliver.mockResolvedValue({ sent: 1, retried: 0, failed: 1, skipped: 0 });
    undelivered.mockResolvedValue(2);

    const response = await POST(authenticated());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      ok: false,
      attention: { ...healthy, undeliveredNotifications: 2, notificationDeliveryUnavailable: false, requiresAttention: true },
    });
    for (const mock of [processInbox, reconcile, retain, recover, deliver]) expect(mock).toHaveBeenCalled();
  });

  it("fails while enabled notification delivery cannot run, so a broken sender is not reported as healthy", async () => {
    quietCycle();
    deliver.mockResolvedValue({ error: true });

    const response = await POST(authenticated());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      ok: false,
      attention: { ...healthy, undeliveredNotifications: 0, notificationDeliveryUnavailable: true, requiresAttention: true },
    });
  });

  it("stays healthy when delivery is disabled or every notification was sent", async () => {
    for (const result of [{ disabled: true }, { sent: 2, retried: 1, failed: 0, skipped: 1 }]) {
      quietCycle();
      deliver.mockResolvedValue(result);
      const response = await POST(authenticated());
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ ok: true, notifications: result, attention: healthyResponse });
    }
  });

  it("reports an unexpected failure without exposing its details", async () => {
    quietCycle();
    recover.mockRejectedValue(new Error("private provider detail"));

    const response = await POST(authenticated());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false });
    expect(reportUnexpectedError).toHaveBeenCalledOnce();
    expect(attention).not.toHaveBeenCalled();
  });
});
