import legacyCatalog from "../infrastructure/fixtures/legacy-catalog.json";
import { loadCatalog } from "../infrastructure/catalog-content";
import { describe, expect, it } from "vitest";
import { InMemoryProductRepository } from "../infrastructure/in-memory-product-repository";
import { SearchProducts } from "./search-products";

describe("SearchProducts", () => {
  const useCase = new SearchProducts(new InMemoryProductRepository(loadCatalog(legacyCatalog)));

  it("searches normalized product and producer text", async () => {
    const result = await useCase.execute({ query: "  チューリップ　" });

    expect(result.products.map((product) => product.slug)).toEqual(["haru-no-hikari"]);
    expect(result.total).toBe(3);
  });

  it("filters by occasion and sorts by price", async () => {
    const result = await useCase.execute({ occasion: "誕生日", sort: "price-desc" });

    expect(result.products.map((product) => product.price.amount)).toEqual([8800, 6600]);
    expect(result.occasions).toContain("誕生日");
  });

  it("returns an empty result for a query with no match", async () => {
    const result = await useCase.execute({ query: "該当しない花" });

    expect(result.products).toEqual([]);
    expect(result.total).toBe(3);
  });
});
