import type { MetadataRoute } from "next";
import { siteContent } from "@/shared/infrastructure/content/site-content";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: siteContent.defaultTitle,
    short_name: siteContent.brandName,
    description: siteContent.description,
    start_url: "/",
    display: "standalone",
    background_color: "#faf8f2",
    theme_color: "#183229",
    lang: "ja",
  };
}
