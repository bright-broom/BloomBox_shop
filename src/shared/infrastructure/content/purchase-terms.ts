import { findStorefrontPage } from "./storefront-content";

/** Payment, cancellation and return terms shown before payment; the 特定商取引法 disclosure is the single source. */
export type PurchaseTerms = Readonly<{ payment: string; cancellation: string; returns: string }>;

export function purchaseTermsFrom(items: readonly Readonly<{ term: string; description: string }>[]): PurchaseTerms {
  const find = (term: string) => {
    const item = items.find((entry) => entry.term === term);
    if (!item) throw new Error(`Missing purchase term: ${term}`);
    return item.description;
  };
  return { payment: find("支払時期"), cancellation: find("キャンセル"), returns: find("返品・交換") };
}

export const purchaseTerms: PurchaseTerms = purchaseTermsFrom(
  findStorefrontPage("commercial-transactions")?.sections.flatMap((section) => section.items ?? []) ?? [],
);
