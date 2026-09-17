import { z } from "zod";
import assets from "../../../../content/product-images.json";

// Publishing an asset requires a reviewed deployment; catalog editors cannot upload files.
export const productImageAssetsSchema = z.array(z.object({
  src: z.string().regex(/^\/images\/products\/[a-z0-9-]+\.(?:png|webp|jpg|jpeg)$/),
  label: z.string().trim().min(1).max(200),
  kind: z.enum(["concept", "photograph"]),
}).strict()).max(1000).refine((items) => new Set(items.map((item) => item.src)).size === items.length, {
  message: "Product image paths must be unique",
});
export const productImageAssets = productImageAssetsSchema.parse(assets);
export const NATIVE_CATALOG_LOCAL_IMAGE_PATTERNS = productImageAssets.map(({ src }) => ({ pathname: src, search: "" }));
// Existing external images remain compatible. New hosts require a reviewed change.
export const NATIVE_CATALOG_IMAGE_HOSTS = ["images.unsplash.com"] as const;

export function isNativeCatalogImageUrl(value: string): boolean {
  if (productImageAssets.some((asset) => asset.src === value)) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && !url.username && !url.password && !url.port && !url.hash
      && NATIVE_CATALOG_IMAGE_HOSTS.some((host) => host === url.hostname);
  } catch {
    return false;
  }
}
