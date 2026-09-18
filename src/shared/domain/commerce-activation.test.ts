import { describe, expect, it } from "vitest";
import { REQUIRED_ACTIVATION_EVIDENCE, acceptsNewCheckout, isCommerceActivationApproved } from "./commerce-activation";
import currentActivation from "../../../config/production-commerce-activation.json";

const complete = () => ({
  schemaVersion: 1,
  status: "approved",
  checkoutProvider: "STRIPE",
  evidence: Object.fromEntries(REQUIRED_ACTIVATION_EVIDENCE.map((name) => [name, { complete: true, reference: `docs/evidence/${name}.md` }])),
});

describe("isCommerceActivationApproved", () => {
  it("accepts only an approved Stripe record with every evidence item complete and referenced", () => {
    expect(isCommerceActivationApproved(complete())).toBe(true);
  });

  it("keeps the checked-in record blocked", () => {
    expect(isCommerceActivationApproved(currentActivation)).toBe(false);
  });

  it.each([
    ["status", (value: ReturnType<typeof complete>) => ({ ...value, status: "blocked" })],
    ["provider", (value: ReturnType<typeof complete>) => ({ ...value, checkoutProvider: "SHOPIFY" })],
    ["schema", (value: ReturnType<typeof complete>) => ({ ...value, schemaVersion: 2 })],
    ["incomplete item", (value: ReturnType<typeof complete>) => ({ ...value, evidence: { ...value.evidence, stripeTestModeE2e: { complete: false, reference: "docs/evidence/x.md" } } })],
    ["short reference", (value: ReturnType<typeof complete>) => ({ ...value, evidence: { ...value.evidence, taxShippingReview: { complete: true, reference: "  todo  " } } })],
    ["missing item", (value: ReturnType<typeof complete>) => {
      const { backupRollbackIncidentRehearsal: _removed, ...evidence } = value.evidence;
      return { ...value, evidence };
    }],
    ["extra item", (value: ReturnType<typeof complete>) => ({ ...value, evidence: { ...value.evidence, extra: { complete: true, reference: "docs/evidence/x.md" } } })],
  ])("rejects a record with a changed %s", (_name, change) => {
    expect(isCommerceActivationApproved(change(complete()))).toBe(false);
  });

  it.each([null, undefined, "approved", [], { evidence: null }])("rejects malformed input %j", (value) => {
    expect(isCommerceActivationApproved(value)).toBe(false);
  });
});

describe("acceptsNewCheckout", () => {
  const open = { runtime: "production" as const, intakeEnabled: true, activationApproved: true, storefrontApproved: true };

  it("opens production only with the switch, approved evidence and approved terms", () => {
    expect(acceptsNewCheckout(open)).toBe(true);
    expect(acceptsNewCheckout({ ...open, intakeEnabled: false })).toBe(false);
    expect(acceptsNewCheckout({ ...open, activationApproved: false })).toBe(false);
    expect(acceptsNewCheckout({ ...open, storefrontApproved: false })).toBe(false);
  });

  it("keeps preview governed by the switch alone, as before", () => {
    expect(acceptsNewCheckout({ runtime: "preview", intakeEnabled: true, activationApproved: false, storefrontApproved: false })).toBe(true);
    expect(acceptsNewCheckout({ runtime: "preview", intakeEnabled: false, activationApproved: true, storefrontApproved: true })).toBe(false);
  });
});
