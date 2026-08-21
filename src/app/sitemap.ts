import type { MetadataRoute } from "next";
import { application } from "@/shared/infrastructure/composition-root";
import { loadSiteUrlConfig } from "@/shared/infrastructure/config/site-url-config";
import { storefrontContent } from "@/shared/infrastructure/content/storefront-content";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { origin } = loadSiteUrlConfig();
  const products = await application.listProducts.execute();
  return [
    { url: origin, changeFrequency: "weekly", priority: 1 },
    { url: `${origin}/flowers`, changeFrequency: "daily", priority: 0.9 },
    ...products.map((product) => ({
      url: `${origin}/flowers/${product.slug}`,
      changeFrequency: "daily" as const,
      priority: 0.8,
      images: [product.imageUrl],
    })),
    ...storefrontContent.pages.map((page) => ({
      url: `${origin}/${page.slug}`,
      changeFrequency: "monthly" as const,
      priority: page.slug === "about" || page.slug === "guide" ? 0.6 : 0.4,
    })),
  ];
}
