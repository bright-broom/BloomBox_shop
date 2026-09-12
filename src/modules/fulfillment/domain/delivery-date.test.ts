import { describe, expect, it } from "vitest";
import {
  assessDeliveryDate,
  InvalidDeliveryAssessmentTimeError,
  getEarliestDeliveryDate,
  getLatestDeliveryDate,
  isAvailableDeliveryDate,
} from "./delivery-date";

describe("delivery date", () => {
  const now = new Date("2026-08-18T16:00:00.000Z");

  it("applies the lead time in Asia/Tokyo", () => {
    expect(getEarliestDeliveryDate(now)).toBe("2026-08-22");
  });

  it("rejects dates before the fulfillment cutoff", () => {
    expect(isAvailableDeliveryDate("2026-08-21", now)).toBe(false);
    expect(isAvailableDeliveryDate("2026-08-22", now)).toBe(true);
  });

  it("limits reservations to the published booking window", () => {
    expect(getLatestDeliveryDate(now)).toBe("2026-10-18");
    expect(isAvailableDeliveryDate("2026-10-18", now)).toBe(true);
    expect(isAvailableDeliveryDate("2026-10-19", now)).toBe(false);
  });

  it.each(["not-a-date", "2026-02-30", "2026-8-22"])("rejects invalid calendar date %s", (value) => {
    expect(isAvailableDeliveryDate(value, now)).toBe(false);
  });
});

describe("delivery timing after delayed payment", () => {
  it("rechecks a previously valid date across the Tokyo midnight cutoff", () => {
    expect(assessDeliveryDate("2026-09-14", new Date("2026-09-11T14:59:59.999Z")))
      .toEqual({ status: "WITHIN_WINDOW", deliveryDate: "2026-09-14" });
    expect(assessDeliveryDate("2026-09-14", new Date("2026-09-11T15:00:00Z")))
      .toEqual({ status: "HELD", reason: "INSUFFICIENT_LEAD_TIME" });
  });
  it("keeps the booking limit inclusive at month and year boundaries", () => {
    const now = new Date("2026-12-30T15:00:00Z");
    expect(assessDeliveryDate("2027-01-03", now)).toMatchObject({ status: "WITHIN_WINDOW" });
    expect(assessDeliveryDate(getLatestDeliveryDate(now), now)).toMatchObject({ status: "WITHIN_WINDOW" });
    expect(assessDeliveryDate("2027-03-02", now)).toEqual({ status: "HELD", reason: "OUTSIDE_BOOKING_WINDOW" });
  });
  it.each(["2026-02-29", "2026-02-30", "2026-9-14", "", "2026-09-14T00:00:00Z"])("holds malformed saved date %s", (date) => {
    expect(assessDeliveryDate(date, new Date("2026-09-11T00:00:00Z"))).toEqual({ status: "HELD", reason: "INVALID_DELIVERY_DATE" });
  });
  it("fails explicitly if the trusted processing clock is invalid", () => {
    expect(() => assessDeliveryDate("2026-09-14", new Date(NaN))).toThrow(InvalidDeliveryAssessmentTimeError);
  });
});
