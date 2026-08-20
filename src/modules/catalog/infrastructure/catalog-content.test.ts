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
});
