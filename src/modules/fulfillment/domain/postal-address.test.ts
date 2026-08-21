import { describe, expect, it } from "vitest";
import {
  formatPostalCode,
  InvalidPostalAddressError,
  InvalidPostalCodeError,
  isValidPostalCode,
  normalizePostalCode,
  postalAddress,
  postalCode,
} from "./postal-address";

describe("postal address policy", () => {
  it("normalizes ASCII, full-width, hyphenated, and spaced postal codes", () => {
    expect(normalizePostalCode("１００ － ０００１")).toBe("1000001");
    expect(postalCode("100-0001")).toBe("1000001");
    expect(formatPostalCode("１０００００１")).toBe("100-0001");
  });

  it("accepts exactly seven digits", () => {
    expect(isValidPostalCode("100-0001")).toBe(true);
    expect(isValidPostalCode("100-001")).toBe(false);
    expect(isValidPostalCode("100-000A")).toBe(false);
    expect(() => postalCode("100-001")).toThrow(InvalidPostalCodeError);
  });

  it("accepts Japanese prefectures and rejects malformed provider addresses", () => {
    expect(postalAddress({ prefecture: "東京都", city: "千代田区", town: "千代田" })).toEqual({
      prefecture: "東京都",
      city: "千代田区",
      town: "千代田",
    });
    expect(() => postalAddress({ prefecture: "東京", city: "", town: "" }))
      .toThrow(InvalidPostalAddressError);
  });
});
