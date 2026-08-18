import { describe, expect, it } from "vitest";
import { getEarliestDeliveryDate, isAvailableDeliveryDate } from "./delivery-date";

describe("delivery date", () => {
  const now = new Date("2026-08-18T16:00:00.000Z");

  it("applies the lead time in Asia/Tokyo", () => {
    expect(getEarliestDeliveryDate(now)).toBe("2026-08-22");
  });

  it("rejects dates before the fulfillment cutoff", () => {
    expect(isAvailableDeliveryDate("2026-08-21", now)).toBe(false);
    expect(isAvailableDeliveryDate("2026-08-22", now)).toBe(true);
  });
});
