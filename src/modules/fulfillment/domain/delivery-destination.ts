import { JAPAN_PREFECTURES, isValidPostalCode, normalizePostalCode, type JapanPrefecture } from "./postal-address";

export const DELIVERY_ADDRESS_TEXT_MAX_LENGTH = 255;
export const DELIVERY_POSTAL_INPUT_MAX_LENGTH = 32;

export type DeliveryCoveragePolicy = Readonly<{ approval: "PENDING" }> | Readonly<{
  approval: "APPROVED"; prefectures: readonly JapanPrefecture[]; excludedPostalPrefixes: readonly string[];
}>;
// User-confirmed on 2026-09-12: all Japanese prefectures, with no regional exclusions.
// Coverage approval alone does not authorize order acceptance, carrier SLAs or dispatch.
export const DELIVERY_COVERAGE_POLICY: DeliveryCoveragePolicy = {
  approval: "APPROVED", prefectures: JAPAN_PREFECTURES, excludedPostalPrefixes: [],
};
export type DeliveryAddress = Readonly<{
  countryCode: string | null; prefecture: string | null; postalCode: string | null;
  recipientName: string | null; city: string | null; addressLine: string | null;
}>;
export type DeliveryDestinationAssessment = Readonly<{ status: "STRUCTURALLY_VALID_AND_COVERED" }> | Readonly<{
  status: "HELD"; reason: "COVERAGE_NOT_APPROVED" | "COVERAGE_INVALID" | "ADDRESS_MISSING" | "ADDRESS_INCOMPLETE"
    | "COUNTRY_UNSUPPORTED" | "PREFECTURE_UNRECOGNIZED" | "POSTAL_CODE_INVALID" | "REGION_EXCLUDED";
}>;

export function isApprovedDeliveryCoverage(policy: DeliveryCoveragePolicy): boolean {
  return policy.approval === "APPROVED" && policy.prefectures.length > 0
    && policy.prefectures.every((prefecture) => JAPAN_PREFECTURES.includes(prefecture))
    && new Set(policy.prefectures).size === policy.prefectures.length
    && policy.excludedPostalPrefixes.every((prefix) => /^\d{1,7}$/.test(prefix));
}
const present = (value: string | null) => value !== null && value.trim().length > 0
  && value.length <= DELIVERY_ADDRESS_TEXT_MAX_LENGTH && !/[\u0000-\u001f\u007f]/.test(value);

/** Structural validation only: no geocoding, carrier promise, identity proof or permission to ship. */
export function assessDeliveryDestination(address: DeliveryAddress | null, policy: DeliveryCoveragePolicy): DeliveryDestinationAssessment {
  if (policy.approval !== "APPROVED") return { status: "HELD", reason: "COVERAGE_NOT_APPROVED" };
  if (!isApprovedDeliveryCoverage(policy)) return { status: "HELD", reason: "COVERAGE_INVALID" };
  if (!address) return { status: "HELD", reason: "ADDRESS_MISSING" };
  if (address.countryCode !== "JP") return { status: "HELD", reason: "COUNTRY_UNSUPPORTED" };
  if (![address.recipientName, address.city, address.addressLine].every(present)) return { status: "HELD", reason: "ADDRESS_INCOMPLETE" };
  const prefecture = JAPAN_PREFECTURES.find((value) => value === address.prefecture?.trim());
  if (!prefecture) return { status: "HELD", reason: "PREFECTURE_UNRECOGNIZED" };
  if (!address.postalCode || address.postalCode.length > DELIVERY_POSTAL_INPUT_MAX_LENGTH || !isValidPostalCode(address.postalCode)) return { status: "HELD", reason: "POSTAL_CODE_INVALID" };
  const postal = normalizePostalCode(address.postalCode);
  if (!policy.prefectures.includes(prefecture) || policy.excludedPostalPrefixes.some((prefix) => postal.startsWith(prefix))) {
    return { status: "HELD", reason: "REGION_EXCLUDED" };
  }
  return { status: "STRUCTURALLY_VALID_AND_COVERED" };
}
