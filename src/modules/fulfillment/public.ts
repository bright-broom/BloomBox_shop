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
export { type ApprovalFormState, type ApprovalFormControl } from "./presentation/approval-form-state";
export { PermissionRevocationError, type PermissionRevocationRequest, type PermissionRevocationReceipt,
  type OperatorPermissionRevoker } from "./application/revoke-operator-permission";
export { PERMISSION_REVOCATION_REASONS, type PermissionRevocationReason } from "./domain/permission-revocation";
export { OPERATOR_PERMISSION_PAGE_SIZE, type OperatorPermissionListRequest, type OperatorPermissionList,
  type OperatorPermissionQuery } from "./application/read-operator-permissions";
export { type PermissionManagementPage, type PermissionManagementState } from "./presentation/permission-management-state";

// Native (Stripe) order fulfillment operations. ADR 0015.
export {
  NATIVE_CARRIER_CODES, NATIVE_FULFILLMENT_ACTIONS, NATIVE_FULFILLMENT_CANCEL_REASONS, NATIVE_FULFILLMENT_ERROR_CODES,
  NATIVE_FULFILLMENT_HOLD_REASONS, NativeFulfillmentError, TRACKING_NUMBER_MAX_LENGTH, TRACKING_NUMBER_MIN_LENGTH,
  type NativeCarrierCode, type NativeFulfillmentAction, type NativeFulfillmentCancelReason, type NativeFulfillmentCommand,
  type NativeFulfillmentDecision, type NativeFulfillmentErrorCode, type NativeFulfillmentFacts, type NativeFulfillmentHoldReason,
  type NativeShipmentEffect,
} from "./domain/native-fulfillment";
export { decideNativeFulfillment, normalizeTrackingNumber } from "./domain/native-fulfillment-policy";
export {
  NATIVE_FULFILLMENT_HISTORY_LIMIT, NATIVE_FULFILLMENT_PAGE_SIZE,
  type NativeFulfillmentActor, type NativeFulfillmentChange, type NativeFulfillmentDestination, type NativeFulfillmentDetail,
  type NativeFulfillmentHistoryEntry, type NativeFulfillmentListQuery, type NativeFulfillmentPage, type NativeFulfillmentReceipt,
  type NativeFulfillmentRecordedChange, type NativeFulfillmentStore, type NativeFulfillmentSummary, type NativeShipment,
} from "./application/manage-native-fulfillment";
export { ApplyNativeFulfillmentCommand } from "./application/apply-native-fulfillment-command";
