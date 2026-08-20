import type { NextConfig } from "next";
import catalog from "./content/catalog.json";
import site from "./content/site.json";
import { SHOPIFY_PRODUCT_IMAGE_HOST } from "./src/shared/infrastructure/config/shopify-storefront-config";

const remoteImageUrls = [site.hero.imageUrl, ...catalog.map((product) => product.imageUrl)];
const remoteImageHosts = new Set([
  ...remoteImageUrls.map((value) => new URL(value).hostname),
  SHOPIFY_PRODUCT_IMAGE_HOST,
]);
const remotePatterns = [...remoteImageHosts].map(
  (hostname) => ({ protocol: "https" as const, hostname }),
);

const nextConfig: NextConfig = {
  images: {
    remotePatterns,
  },
};

export default nextConfig;
