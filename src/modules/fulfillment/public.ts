export {
  assessDeliveryDate,
  type DeliveryDateAssessment,
  InvalidDeliveryAssessmentTimeError,
  assertAvailableDeliveryDate,
  DeliveryDateUnavailableError,
  DELIVERY_BOOKING_WINDOW_DAYS,
  DELIVERY_LEAD_TIME_DAYS,
  getEarliestDeliveryDate,
  getLatestDeliveryDate,
  isAvailableDeliveryDate,
} from "./domain/delivery-date";
export {
  assertFulfillmentTransition,
  FULFILLMENT_STATUSES,
  InvalidFulfillmentTransitionError,
  type FulfillmentStatus,
} from "./domain/fulfillment-status";
export {
  formatPostalCode,
  InvalidPostalCodeError,
  isValidPostalCode,
  JAPAN_PREFECTURES,
  normalizePostalCode,
  POSTAL_CODE_DIGITS,
  postalCode,
  type JapanPrefecture,
  type PostalAddress,
  type PostalAddressRepository,
  type PostalCode,
} from "./domain/postal-address";
export { LookupPostalCode, type PostalCodeLookupResult } from "./application/lookup-postal-code";
export { type ShopifyFulfillmentIntake, type ShopifyFulfillmentReference, type ShopifyFulfillmentIntakeResult, ShopifyFulfillmentIntakeError } from "./application/reconcile-shopify-fulfillment";
export { FULFILLMENT_INTAKE_POLICY, type FulfillmentIntakePolicy, type FulfillmentIntakeDecision } from "./domain/shopify-fulfillment-intake";
export { type ShopifyFulfillmentReader, type ShopifyFulfillmentSnapshot, ShopifyFulfillmentUnavailableError } from "./application/read-shopify-fulfillments";
export { type ShopifyFulfillmentFact, type ShopifyFulfillmentActivity } from "./domain/shopify-fulfillment-observation";
export {
  postalCodeLookupRequestSchema,
  postalCodeLookupResponseSchema,
  type PostalCodeLookupApiResponse,
} from "./presentation/postal-code-api-schema";
export {
  assessDeliveryDestination, isApprovedDeliveryCoverage, DELIVERY_COVERAGE_POLICY,
  DELIVERY_ADDRESS_TEXT_MAX_LENGTH, DELIVERY_POSTAL_INPUT_MAX_LENGTH,
  type DeliveryCoveragePolicy, type DeliveryAddress, type DeliveryDestinationAssessment,
} from "./domain/delivery-destination";

export { type ShopifyFulfillmentQuantities, type FulfillmentQuantityAssessment } from "./domain/shopify-fulfillment-quantities";
export { type ShopifyFulfillmentStockSnapshot, type FulfillmentStockAssessment } from "./domain/shopify-fulfillment-stock";
export { type ShopifyFulfillmentStockReader, ShopifyFulfillmentStockUnavailableError } from "./application/read-shopify-fulfillment-stock";
export { parseShopifyFulfillmentStockSnapshot } from "./infrastructure/shopify-fulfillment-stock-schema";
export { FulfillmentApprovalError, type FulfillmentOperatorIdentity, type FulfillmentApprovalRequest,
  type FulfillmentApprovalReceipt, type ShopifyFulfillmentApprover } from "./application/approve-shopify-fulfillment";
export { FulfillmentReviewError, type FulfillmentReview, type FulfillmentReviewQuery } from "./application/read-fulfillment-review";
export { fulfillmentReviewSummary } from "./presentation/fulfillment-review-summary";
export { FULFILLMENT_INBOX_PAGE_SIZE, type FulfillmentInbox, type FulfillmentInboxRequest, type FulfillmentInboxQuery } from "./application/read-fulfillment-inbox";
