import type { NextConfig } from "next";
import catalog from "./content/catalog.json";
import site from "./content/site.json";

const remoteImageUrls = [site.hero.imageUrl, ...catalog.map((product) => product.imageUrl)];
const remotePatterns = [...new Set(remoteImageUrls.map((value) => new URL(value).hostname))].map(
  (hostname) => ({ protocol: "https" as const, hostname }),
);

const nextConfig: NextConfig = {
  images: {
    remotePatterns,
  },
};

export default nextConfig;
