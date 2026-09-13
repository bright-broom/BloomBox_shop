import { describe, expect, it } from "vitest";
import { loadCatalog } from "./catalog-content";
import { readFile } from "node:fs/promises";
import catalog from "../../../../content/catalog.json";

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

  it("loads distinct, bundled package images for M and L", async () => {
    const products = loadCatalog();
    expect(new Set(products.map((product) => product.imageUrl)).size).toBe(2);
    for (const product of products) {
      expect(product.imageUrl).toBe(`/images/products/bloombox-${product.previewOffer?.size.toLowerCase()}-concept.png`);
      const asset = await readFile(`public${product.imageUrl}`);
      expect(asset.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    }
  });

  it.each(["//example.test/image.png", "/images/products/../private.png", "/images/products/box.png?path=other", "/images/products/box.svg"])("rejects unsupported local image paths: %s", (imageUrl) => {
    expect(() => loadCatalog([{ ...catalog[0], imageUrl }])).toThrow();
  });
});
