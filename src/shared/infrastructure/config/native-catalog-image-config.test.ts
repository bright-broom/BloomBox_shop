import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import nextConfig from "../../../../next.config";
import { catalogSaveSchema } from "@/modules/catalog/infrastructure/postgres-catalog-manager";
import { isNativeCatalogImageUrl, productImageAssets, productImageAssetsSchema } from "./native-catalog-image-config";

describe("registered product images", () => {
  it("permits deployed assets at the persistence boundary and image optimizer", async () => {
    for (const asset of productImageAssets) {
      expect(isNativeCatalogImageUrl(asset.src)).toBe(true);
      expect(catalogSaveSchema.shape.imageUrl.safeParse(asset.src).success).toBe(true);
      expect(nextConfig.images?.localPatterns).toContainEqual({ pathname: asset.src, search: "" });
      const bytes = await readFile(`public${asset.src}`);
      // Detect empty files and extension/content mismatches before deployment.
      const signature = bytes.subarray(0, 12).toString("hex");
      if (asset.src.endsWith(".png")) expect(signature.startsWith("89504e470d0a1a0a")).toBe(true);
      else if (/\.jpe?g$/.test(asset.src)) expect(signature.startsWith("ffd8ff")).toBe(true);
      else { expect(bytes.subarray(0, 4).toString()).toBe("RIFF"); expect(bytes.subarray(8, 12).toString()).toBe("WEBP"); }
    }
  });
  it.each([
    "/images/products/missing.png", "/images/products/../private.png", "/images/products/%2e%2e/private.png",
    "/images/products/bloombox-blue-concept.png?cache=1", "/images/products/bloombox-blue-concept.png#fragment",
    "//images.unsplash.com/test", "http://images.unsplash.com/test", "https://images.unsplash.com.attacker.test/test",
    "https://user:secret@images.unsplash.com/test", "https://images.unsplash.com:444/test", "https://images.unsplash.com/test#fragment",
    "data:image/png;base64,test", "https://127.0.0.1/private", "/images/products/box.svg", "\\images\\products\\box.png",
  ])("rejects unregistered or unsafe image references: %s", (value) => {
    expect(isNativeCatalogImageUrl(value)).toBe(false);
    expect(catalogSaveSchema.shape.imageUrl.safeParse(value).success).toBe(false);
  });
  it("preserves existing Unsplash images and disables optimizer redirects", () => {
    expect(isNativeCatalogImageUrl("https://images.unsplash.com/photo-example?auto=format&w=800")).toBe(true);
    expect(nextConfig.images?.maximumRedirects).toBe(0);
  });
  it("rejects duplicate registry paths, traversal, active formats and missing asset descriptions", () => {
    const asset = productImageAssets[0];
    expect(productImageAssetsSchema.safeParse([asset, asset]).success).toBe(false);
    for (const change of [{src:"/images/products/../private.png"}, {src:"/images/products/test.svg"}, {label:""}, {kind:"approved"}]) {
      expect(productImageAssetsSchema.safeParse([{...asset, ...change}]).success).toBe(false);
    }
  });
});
