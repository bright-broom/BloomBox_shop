import { describe, expect, it } from "vitest";
import { loadCatalog } from "./catalog-content";

describe("catalog content", () => {
  it("is valid and has unique public identifiers", () => {
    const products = loadCatalog();

    expect(products.length).toBeGreaterThan(0);
    expect(new Set(products.map((product) => product.id)).size).toBe(products.length);
    expect(new Set(products.map((product) => product.externalReference)).size).toBe(products.length);
    expect(new Set(products.map((product) => product.slug)).size).toBe(products.length);
  });

  it("offers one preview family with two explicit size SKUs and no invented dimensions", () => {
    const products = loadCatalog();
    expect(products.map((product) => [product.previewOffer?.family, product.previewOffer?.size, product.price.amount, product.previewOffer?.shippingAmount]))
      .toEqual([["bloom-box", "M", 4000, 1000], ["bloom-box", "L", 8000, 0]]);
    expect(products.every((product) => product.description.includes("箱の寸法は現在準備中"))).toBe(true);
  });
});
