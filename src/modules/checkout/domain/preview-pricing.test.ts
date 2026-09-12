import { describe, expect, it } from "vitest";
import { previewTotals, assertPreviewQuantity } from "./preview-pricing";

describe("launch preview pricing", () => {
  it.each([[4000, 1000, 0, 5000], [8000, 0, 0, 8000], [8000, 0, 500, 7500]])("calculates product %i, shipping %i and discount %i", (product, shipping, discount, total) => {
    expect(previewTotals(product, shipping, discount).totalAmount).toBe(total);
  });
  it.each([[-1, 0, 0], [4000, -1, 0], [4000, 0, 4001], [1.5, 0, 0], [Number.MAX_SAFE_INTEGER, 1, 0]])("rejects invalid or overflowing totals", (product, shipping, discount) => {
    expect(() => previewTotals(product, shipping, discount)).toThrow();
  });
  it("requires one launch box without changing legacy quantity rules", () => {
    expect(() => assertPreviewQuantity(1, true)).not.toThrow();
    expect(() => assertPreviewQuantity(2, true)).toThrow();
    expect(() => assertPreviewQuantity(2, false)).not.toThrow();
  });
});
