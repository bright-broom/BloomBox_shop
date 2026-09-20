import { describe, expect, it } from "vitest";
import { InvalidOrderRetentionError, ORDER_PII_RETENTION_DAYS, orderPiiRetentionExpiry } from "./order-retention";

describe("orderPiiRetentionExpiry", () => {
  it("counts from the delivery date when the gift is ordered ahead", () => {
    expect(orderPiiRetentionExpiry("2026-12-24", new Date("2026-09-20T00:00:00Z")).toISOString())
      .toBe(new Date(Date.UTC(2026, 11, 24) + ORDER_PII_RETENTION_DAYS * 86_400_000).toISOString());
  });

  it("counts from the confirmation when it is later, for example a late shipment", () => {
    const confirmed = new Date("2026-10-05T09:00:00Z");
    expect(orderPiiRetentionExpiry("2026-10-01", confirmed).toISOString())
      .toBe(new Date(confirmed.getTime() + ORDER_PII_RETENTION_DAYS * 86_400_000).toISOString());
  });

  it("keeps the window long enough for the published return and support conditions", () => {
    expect(ORDER_PII_RETENTION_DAYS).toBeGreaterThanOrEqual(90);
  });

  it.each([
    ["2026-10-1", new Date("2026-10-05T00:00:00Z"), undefined],
    ["not-a-date", new Date("2026-10-05T00:00:00Z"), undefined],
    ["2026-13-45", new Date("2026-10-05T00:00:00Z"), undefined],
    ["2026-10-01", new Date(Number.NaN), undefined],
    ["2026-10-01", new Date("2026-10-05T00:00:00Z"), 0],
    ["2026-10-01", new Date("2026-10-05T00:00:00Z"), -1],
  ])("rejects invalid input: %s %s %s", (deliveryDate, confirmedAt, days) => {
    expect(() => orderPiiRetentionExpiry(deliveryDate, confirmedAt, days)).toThrow(InvalidOrderRetentionError);
  });
});
