import { describe, expect, it, vi } from "vitest";
import type { DatabaseClient } from "@/shared/infrastructure/database/postgres-client";
import { commerceWorkerAttention, PostgresCommerceWorkerAttention } from "./postgres-commerce-worker-attention";

function sqlReturning(rows: unknown[]) {
  return vi.fn(async () => rows) as unknown as DatabaseClient;
}

describe("commerce worker attention", () => {
  it.each([
    { failed: 0, review: 0, requiresAttention: false },
    { failed: 1, review: 0, requiresAttention: true },
    { failed: 0, review: 1, requiresAttention: true },
    { failed: 2, review: 3, requiresAttention: true },
  ])("requires attention while any unresolved condition remains: %j", ({ failed, review, requiresAttention }) => {
    expect(commerceWorkerAttention(failed, review)).toEqual({
      failedInboxEvents: failed, unrecordedCheckoutsAwaitingReview: review, requiresAttention,
    });
  });

  it("reports unresolved counts from storage", async () => {
    const attention = new PostgresCommerceWorkerAttention(sqlReturning([{ failed_inbox_events: 1, unrecorded_checkouts_awaiting_review: 0 }]));
    await expect(attention.execute()).resolves.toEqual({ failedInboxEvents: 1, unrecordedCheckoutsAwaitingReview: 0, requiresAttention: true });
  });

  it.each([[[]], [[{ failed_inbox_events: -1, unrecorded_checkouts_awaiting_review: 0 }]], [[{ failed_inbox_events: "1", unrecorded_checkouts_awaiting_review: 0 }]]])(
    "treats a malformed count as a fault instead of a healthy worker: %j",
    async (rows) => {
      await expect(new PostgresCommerceWorkerAttention(sqlReturning(rows)).execute()).rejects.toThrow();
    },
  );
});
