import { beforeEach, describe, expect, it, vi } from "vitest";

const { byId } = vi.hoisted(() => ({ byId: vi.fn() }));
vi.mock("@/shared/infrastructure/composition-root", () => ({
  application: { getProduct: { byId }, listProducts: { execute: vi.fn() } },
}));

import { generateMetadata } from "./page";

function params(productId: string) {
  return { params: Promise.resolve({ productId }) };
}

describe("gift page metadata", () => {
  beforeEach(() => byId.mockReset());

  it("names the page after the product so each gift step is distinguishable", async () => {
    byId.mockResolvedValue({ name: "BLOOM BOX M" });
    await expect(generateMetadata(params("prod_bloombox_m"))).resolves.toEqual({
      title: "BLOOM BOX Mのギフト設定",
      robots: { index: false, follow: false },
    });
  });

  it("keeps a distinct, non-indexed title when the product is unavailable", async () => {
    byId.mockResolvedValue(null);
    await expect(generateMetadata(params("prod_missing"))).resolves.toEqual({
      title: "ギフトの設定",
      robots: { index: false, follow: false },
    });
  });
});
