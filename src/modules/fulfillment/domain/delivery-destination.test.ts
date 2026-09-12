import { describe, expect, it } from "vitest";
import { JAPAN_PREFECTURES } from "./postal-address";
import { assessDeliveryDestination, DELIVERY_COVERAGE_POLICY, type DeliveryAddress, type DeliveryCoveragePolicy } from "./delivery-destination";

const policy: DeliveryCoveragePolicy = { approval: "APPROVED", prefectures: ["東京都", "神奈川県"], excludedPostalPrefixes: ["10021"] };
const address: DeliveryAddress = { countryCode: "JP", prefecture: "東京都", postalCode: "100-0001", recipientName: "テスト受取人", city: "千代田区", addressLine: "テスト町1-2-3" };
describe("delivery destination and approved coverage", () => {
  it("holds every destination while regional terms are unapproved", () => {
    expect(assessDeliveryDestination(address, { approval: "PENDING" })).toEqual({ status: "HELD", reason: "COVERAGE_NOT_APPROVED" });
  });
  it("covers all 47 user-approved prefectures without excluding remote postal prefixes", () => {
    expect(JAPAN_PREFECTURES).toHaveLength(47);
    for (const prefecture of JAPAN_PREFECTURES) {
      expect(assessDeliveryDestination({ ...address, prefecture }, DELIVERY_COVERAGE_POLICY))
        .toEqual({ status: "STRUCTURALLY_VALID_AND_COVERED" });
    }
    for (const postalCode of ["100-2101", "907-1544"]) {
      expect(assessDeliveryDestination({ ...address, postalCode }, DELIVERY_COVERAGE_POLICY))
        .toEqual({ status: "STRUCTURALLY_VALID_AND_COVERED" });
    }
    expect(assessDeliveryDestination({ ...address, countryCode: "US" }, DELIVERY_COVERAGE_POLICY))
      .toEqual({ status: "HELD", reason: "COUNTRY_UNSUPPORTED" });
    expect(assessDeliveryDestination({ ...address, postalCode: "invalid" }, DELIVERY_COVERAGE_POLICY))
      .toEqual({ status: "HELD", reason: "POSTAL_CODE_INVALID" });
  });
  it("returns only a structural/coverage result, never recipient data", () => {
    expect(assessDeliveryDestination(address, policy)).toEqual({ status: "STRUCTURALLY_VALID_AND_COVERED" });
  });
  it("normalizes Japanese postal digits without making a delivery or identity guarantee", () => {
    expect(assessDeliveryDestination({ ...address, postalCode: "１００－０００１" }, policy)).toMatchObject({ status: "STRUCTURALLY_VALID_AND_COVERED" });
  });
  it.each([null, "", "   ", "test\nvalue", "a".repeat(256)])("holds incomplete or unsafe required fields %j", (value) => {
    for (const field of ["recipientName", "city", "addressLine"] as const) {
      expect(assessDeliveryDestination({ ...address, [field]: value }, policy)).toEqual({ status: "HELD", reason: "ADDRESS_INCOMPLETE" });
    }
  });
  it("holds missing addresses and unknown countries/prefectures", () => {
    expect(assessDeliveryDestination(null, policy)).toEqual({ status: "HELD", reason: "ADDRESS_MISSING" });
    expect(assessDeliveryDestination({ ...address, countryCode: "US" }, policy)).toEqual({ status: "HELD", reason: "COUNTRY_UNSUPPORTED" });
    expect(assessDeliveryDestination({ ...address, prefecture: "Tokyo" }, policy)).toEqual({ status: "HELD", reason: "PREFECTURE_UNRECOGNIZED" });
  });
  it.each([null, "", "123456", "12345678", "abcdefg", "100.0001"])("rejects malformed postal code %j", (postalCode) => {
    expect(assessDeliveryDestination({ ...address, postalCode }, policy)).toEqual({ status: "HELD", reason: "POSTAL_CODE_INVALID" });
  });
  it("excludes unapproved prefectures and normalized postal prefixes", () => {
    expect(assessDeliveryDestination({ ...address, prefecture: "大阪府" }, policy)).toEqual({ status: "HELD", reason: "REGION_EXCLUDED" });
    expect(assessDeliveryDestination({ ...address, postalCode: "１００－２１０１" }, policy)).toEqual({ status: "HELD", reason: "REGION_EXCLUDED" });
  });
  it.each([
    { prefectures: [] }, { prefectures: ["東京都", "東京都"] }, { excludedPostalPrefixes: [""] }, { excludedPostalPrefixes: ["100-21"] },
  ] as const)("fails closed on invalid approved policy: %j", (overrides) => {
    expect(assessDeliveryDestination(address, { approval: "APPROVED", prefectures: ["東京都"], excludedPostalPrefixes: [], ...overrides }))
      .toEqual({ status: "HELD", reason: "COVERAGE_INVALID" });
  });
});
