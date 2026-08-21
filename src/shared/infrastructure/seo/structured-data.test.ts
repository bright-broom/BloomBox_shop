import { describe, expect, it } from "vitest";
import { money } from "@/shared/domain/money";
import { productId, type Product } from "@/modules/catalog/public";
import { createProductStructuredData, serializeStructuredData } from "./structured-data";

describe("structured data", () => {
  it("maps server-authoritative product facts", () => {
    const value = createProductStructuredData(product(), "https://shop.example.test");

    expect(value.offers).toMatchObject({
      priceCurrency: "JPY",
      price: "6600",
      availability: "https://schema.org/InStock",
    });
    expect(value.url).toBe("https://shop.example.test/flowers/test-flower");
  });

  it("escapes HTML openings before rendering JSON-LD", () => {
    expect(serializeStructuredData({ name: "</script><script>alert(1)</script>" }))
      .not.toContain("<");
  });
});

function product(): Product {
  return {
    id: productId("prod_test_01"),
    externalReference: "gid://shopify/ProductVariant/1",
    slug: "test-flower",
    name: "テストの花",
    subtitle: "テスト",
    description: "説明",
    price: money(6600),
    imageUrl: "https://cdn.shopify.com/test.jpg",
    imageAlt: "テストの花",
    palette: "White",
    occasion: ["誕生日"],
    flowers: ["バラ"],
    grower: "テスト農園",
    available: true,
  };
}
