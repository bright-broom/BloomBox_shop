import { describe, expect, it } from "vitest";
import { reservationTransition } from "./reservation";

describe("inventory terminal states", () => {
  it("makes repeated completion a no-op and refuses reversing a committed or released reservation", () => {
    expect(reservationTransition("HELD", "COMMITTED")).toBe(true);
    expect(reservationTransition("HELD", "RELEASED")).toBe(true);
    expect(reservationTransition("COMMITTED", "COMMITTED")).toBe(false);
    expect(reservationTransition("RELEASED", "RELEASED")).toBe(false);
    expect(() => reservationTransition("COMMITTED", "RELEASED")).toThrow();
    expect(() => reservationTransition("RELEASED", "COMMITTED")).toThrow();
  });
});
