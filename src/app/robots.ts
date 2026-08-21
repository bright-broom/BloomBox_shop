import type { MetadataRoute } from "next";
import { loadRuntimeMode } from "@/shared/infrastructure/config/runtime-config";
import { loadSiteUrlConfig } from "@/shared/infrastructure/config/site-url-config";

export default function robots(): MetadataRoute.Robots {
  const { origin } = loadSiteUrlConfig();
  if (loadRuntimeMode() === "preview") {
    return { rules: { userAgent: "*", disallow: "/" } };
  }
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/cart", "/checkout/", "/gift/", "/order/"],
    },
    sitemap: `${origin}/sitemap.xml`,
  };
}
