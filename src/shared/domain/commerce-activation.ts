/**
 * Governed production checkout activation (ADR 0020). Pure rules shared by the runtime gate; the release
 * script `check-production-readiness.mjs` applies the same evidence rules before deployment.
 */
export const REQUIRED_ACTIVATION_EVIDENCE = [
  "activationDecisionAdr",
  "nativeCatalogContract",
  "stripeTestModeE2e",
  "inventoryReservationStrategy",
  "taxShippingReview",
  "privacySupportReview",
  "storefrontLegalSupportApproval",
  "backupRollbackIncidentRehearsal",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True only for an approved Stripe activation record whose every required evidence item is complete and referenced. */
export function isCommerceActivationApproved(activation: unknown): boolean {
  if (!isRecord(activation) || activation.schemaVersion !== 1 || activation.status !== "approved" || activation.checkoutProvider !== "STRIPE") {
    return false;
  }
  const evidence = activation.evidence;
  if (!isRecord(evidence) || Object.keys(evidence).length !== REQUIRED_ACTIVATION_EVIDENCE.length) return false;
  return REQUIRED_ACTIVATION_EVIDENCE.every((name) => {
    const item = evidence[name];
    return isRecord(item) && item.complete === true && typeof item.reference === "string" && item.reference.trim().length >= 8;
  });
}

export type CheckoutIntakeInput = Readonly<{
  runtime: "preview" | "production";
  /** BLOOMBOX_CHECKOUT_INTAKE_ENABLED: the operator's switch, and the immediate pause in an incident. */
  intakeEnabled: boolean;
  activationApproved: boolean;
  storefrontApproved: boolean;
}>;

/**
 * New purchases are accepted only while the switch is on. Production additionally requires the reviewed
 * activation evidence and approved customer-facing terms; existing payments and settlement never depend on this.
 */
export function acceptsNewCheckout(input: CheckoutIntakeInput): boolean {
  if (!input.intakeEnabled) return false;
  if (input.runtime === "preview") return true;
  return input.activationApproved && input.storefrontApproved;
}
