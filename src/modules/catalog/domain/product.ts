import type { Money } from "@/shared/domain/money";

export type ProductId = string & { readonly __brand: "ProductId" };

export type Product = Readonly<{
  id: ProductId;
  externalReference: string;
  slug: string;
  name: string;
  subtitle: string;
  description: string;
  price: Money;
  /** JPY shipping for one box. Undefined is unconfigured, not free. */
  shippingAmount?: number;
  imageUrl: string;
  imageAlt: string;
  palette: string;
  occasion: readonly string[];
  flowers: readonly string[];
  grower: string;
  available: boolean;
  /** Launch-preview SKU metadata. Never populated by production catalog adapters. */
  previewOffer?: Readonly<{ family: string; size: "M" | "L"; shippingAmount: number }>;
}>;

export function productId(value: string): ProductId {
  if (value.trim().length === 0) {
    throw new Error("Product ID cannot be empty");
  }

  return value as ProductId;
}
