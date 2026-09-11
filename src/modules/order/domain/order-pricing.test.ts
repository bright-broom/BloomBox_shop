import { describe, expect, it } from "vitest";
import { assessOrderPricing, type OrderPricingFacts } from "./order-pricing";

function box(overrides: Partial<OrderPricingFacts> = {}): OrderPricingFacts {
  return { taxesIncluded: true, estimatedTaxes: false, edited: false,
    subtotal: 4000, currentSubtotal: 4000, tax: 454, currentTax: 454, total: 5000, originalTotal: 5000, currentTotal: 5000,
    currentShipping: 1000, duties: 0, currentDuties: 0, additionalFees: 0, currentAdditionalFees: 0, tips: 0,
    lines: [{ unitPrice: 4000, quantity: 1, currentQuantity: 1, discounts: [] }],
    shipping: [{ originalPrice: 1000, discountedPrice: 1000, currentDiscountedPrice: 1000, removed: false }], ...overrides };
}
describe("authoritative order pricing arithmetic", () => {
  it("retains inclusive tax as information without adding it to the M total again", () => {
    expect(assessOrderPricing(box())).toEqual({ status: "MATCHED", totals: {
      currency: "JPY", taxesIncluded: true, merchandise: 4000, merchandiseDiscount: 0,
      shipping: 1000, shippingDiscount: 0, tax: 454, total: 5000,
    } });
  });
  it("adds exclusive tax exactly once, without deciding the store's tax policy", () => {
    expect(assessOrderPricing(box({ taxesIncluded: false, tax: 500, currentTax: 500, total: 5500, originalTotal: 5500, currentTotal: 5500 })))
      .toMatchObject({ status: "MATCHED", totals: { taxesIncluded: false, total: 5500, tax: 500 } });
  });
  it("reconciles allocated product discounts and free shipping independently", () => {
    expect(assessOrderPricing(box({
      lines: [{ unitPrice: 8000, quantity: 1, currentQuantity: 1, discounts: [300, 200] }],
      subtotal: 7500, currentSubtotal: 7500, total: 7500, originalTotal: 7500, currentTotal: 7500,
      currentShipping: 0, tax: 681, currentTax: 681,
      shipping: [{ originalPrice: 1000, discountedPrice: 0, currentDiscountedPrice: 0, removed: false }],
    }))).toMatchObject({ status: "MATCHED", totals: { merchandise: 8000, merchandiseDiscount: 500,
      shipping: 1000, shippingDiscount: 1000, total: 7500 } });
  });
  it("handles inclusive rounding supplied by the provider without inventing a tax rate", () => {
    expect(assessOrderPricing(box({ tax: 453, currentTax: 453 }))).toMatchObject({ status: "MATCHED", totals: { tax: 453 } });
  });
  it("holds absent pricing rather than defaulting final tax or shipping to zero", () => {
    expect(assessOrderPricing(null)).toEqual({ status: "HELD", reason: "MISSING_PRICING" });
  });
  it("holds estimated tax", () => {
    expect(assessOrderPricing(box({ estimatedTaxes: true }))).toEqual({ status: "HELD", reason: "ESTIMATED_TAXES" });
  });
  it.each([
    { edited: true }, { currentTotal: 4500 }, { currentSubtotal: 3500 }, { currentTax: 0 },
    { total: 5100, currentTotal: 5100 },
    { lines: [{ unitPrice: 4000, quantity: 1, currentQuantity: 0, discounts: [] }] },
    { shipping: [{ originalPrice: 1000, discountedPrice: 1000, currentDiscountedPrice: 500, removed: false }] },
    { shipping: [{ originalPrice: 1000, discountedPrice: 1000, currentDiscountedPrice: 1000, removed: true }] },
  ])("holds changed or returned amounts even when payment is valid: %j", (overrides) => {
    expect(assessOrderPricing(box(overrides))).toEqual({ status: "HELD", reason: "ORDER_CHANGED" });
  });
  it.each(["duties", "currentDuties", "additionalFees", "currentAdditionalFees", "tips"] as const)("holds unsupported %s", (key) => {
    expect(assessOrderPricing(box({ [key]: 1 }))).toEqual({ status: "HELD", reason: "UNSUPPORTED_CHARGES" });
  });
  it.each([{ shipping: [] }, { shipping: [box().shipping[0], box().shipping[0]] }])("holds missing or multiple shipping lines", ({ shipping }) => {
    expect(assessOrderPricing(box({ shipping }))).toEqual({ status: "HELD", reason: "UNSUPPORTED_SHIPPING" });
  });
  it.each([
    { total: 5454, originalTotal: 5454, currentTotal: 5454 }, // Inclusive tax charged twice.
    { subtotal: 3500, currentSubtotal: 3500 }, // Unallocated discount.
    { currentShipping: 0 },
    { shipping: [{ originalPrice: 900, discountedPrice: 1000, currentDiscountedPrice: 1000, removed: false }] },
    { lines: [{ unitPrice: 4000, quantity: 1, currentQuantity: 1, discounts: [4001] }] },
    { tax: 5001, currentTax: 5001 },
  ])("holds inconsistent totals without returning usable prices: %j", (overrides) => {
    expect(assessOrderPricing(box(overrides))).toEqual({ status: "HELD", reason: "AMOUNT_MISMATCH" });
  });
  it.each([NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])("rejects invalid money %s", (tax) => {
    expect(assessOrderPricing(box({ tax }))).toEqual({ status: "HELD", reason: "INVALID_AMOUNTS" });
  });
  it("rejects multiplication and accumulation overflow before trusting arithmetic", () => {
    for (const lines of [
      [{ unitPrice: Number.MAX_SAFE_INTEGER, quantity: 2, currentQuantity: 2, discounts: [] }],
      [{ unitPrice: Number.MAX_SAFE_INTEGER, quantity: 1, currentQuantity: 1, discounts: [Number.MAX_SAFE_INTEGER, 1] }],
      [{ unitPrice: Number.MAX_SAFE_INTEGER, quantity: 1, currentQuantity: 1, discounts: [] }, box().lines[0]],
    ]) expect(assessOrderPricing(box({ lines }))).toEqual({ status: "HELD", reason: "INVALID_AMOUNTS" });
  });
  it("rejects zero totals, no merchandise and zero quantity", () => {
    for (const overrides of [{ total: 0 }, { lines: [] }, { lines: [{ ...box().lines[0], quantity: 0 }] }]) {
      expect(assessOrderPricing(box(overrides))).toEqual({ status: "HELD", reason: "INVALID_AMOUNTS" });
    }
  });
});
