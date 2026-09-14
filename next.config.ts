import type { NextConfig } from "next";
import catalog from "./content/catalog.json";
import site from "./content/site.json";
import { SHOPIFY_PRODUCT_IMAGE_HOST } from "./src/shared/infrastructure/config/shopify-storefront-config";

import { NATIVE_CATALOG_IMAGE_HOSTS } from "./src/shared/infrastructure/config/native-catalog-image-config";

const remoteImageUrls = [site.hero.imageUrl, ...catalog.map((product) => product.imageUrl)];
const remoteImageHosts = new Set([
  ...remoteImageUrls.filter((value) => !value.startsWith("/")).map((value) => new URL(value).hostname),
  SHOPIFY_PRODUCT_IMAGE_HOST,
  ...NATIVE_CATALOG_IMAGE_HOSTS,
]);
const remotePatterns = [...remoteImageHosts].map(
  (hostname) => ({ protocol: "https" as const, hostname }),
);
const securityHeaders = [
  { key: "Content-Security-Policy", value: "base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=()" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  ...(process.env.BLOOMBOX_RUNTIME_MODE === "production" ? [{
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  }] : []),
];

const nextConfig: NextConfig = {
  images: {
    remotePatterns,
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        source: "/checkout/:path*",
        headers: [
          { key: "Cache-Control", value: "private, no-store, max-age=0" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
      { source: "/cart", headers: [
        { key: "Cache-Control", value: "private, no-store, max-age=0" },
        { key: "Referrer-Policy", value: "same-origin" },
      ] },
      ...["/operations/:path*", "/api/operator-auth/:path*"].map((source) => ({ source, headers: [
        { key: "Content-Security-Policy", value: "base-uri 'self'; form-action 'self' https://accounts.google.com; frame-ancestors 'none'; object-src 'none'" },
        { key: "Cache-Control", value: "private, no-store, max-age=0" },
        // Native form POSTs need an Origin; no-referrer would turn it into null.
        // same-origin still suppresses Referer on navigation to Google or other sites.
        { key: "Referrer-Policy", value: source === "/operations/:path*" ? "same-origin" : "no-referrer" },
        { key: "X-Robots-Tag", value: "noindex, nofollow" },
      ] })),
    ];
  },
};

export default nextConfig;
