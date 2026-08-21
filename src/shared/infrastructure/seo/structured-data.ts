import type { Product } from "@/modules/catalog/public";

const SCHEMA_ORIGIN = "https://schema.org";

export function createProductStructuredData(product: Product, origin: string) {
  return {
    "@context": SCHEMA_ORIGIN,
    "@type": "Product",
    name: product.name,
    description: product.description,
    image: [product.imageUrl],
    url: `${origin}/flowers/${product.slug}`,
    brand: { "@type": "Brand", name: "BloomBox" },
    offers: {
      "@type": "Offer",
      priceCurrency: product.price.currency,
      price: String(product.price.amount),
      availability: `${SCHEMA_ORIGIN}/${product.available ? "InStock" : "OutOfStock"}`,
      itemCondition: `${SCHEMA_ORIGIN}/NewCondition`,
      url: `${origin}/flowers/${product.slug}`,
    },
  };
}

export function serializeStructuredData(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}
