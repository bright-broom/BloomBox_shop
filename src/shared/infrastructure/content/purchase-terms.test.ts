import { describe, expect, it } from "vitest";
import { findStorefrontPage } from "./storefront-content";
import { purchaseTerms, purchaseTermsFrom } from "./purchase-terms";
import { ORDER_CHANGE_DEADLINE_DAYS } from "@/modules/order/public";

describe("purchase terms", () => {
  it("use the 特定商取引法 disclosure as the single source", () => {
    const items = findStorefrontPage("commercial-transactions")!.sections.flatMap((section) => section.items ?? []);
    const text = (term: string) => items.find((item) => item.term === term)!.description;
    expect(purchaseTerms).toEqual({ payment: text("支払時期"), cancellation: text("キャンセル"), returns: text("返品・交換") });
  });

  it("state the same cancellation deadline the order pages compute", () => {
    // The portal tells each buyer a concrete date from this constant; the disclosure must not drift from it.
    expect(purchaseTerms.cancellation).toContain(`${ORDER_CHANGE_DEADLINE_DAYS}日前`);
  });

  it("fail at startup when a required term is removed from the disclosure", () => {
    expect(() => purchaseTermsFrom([{ term: "支払時期", description: "確定時" }])).toThrow("キャンセル");
  });
});
