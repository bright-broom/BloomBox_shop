// Keep the native catalog and Next image optimizer on the same explicit host list.
// Adding the production asset host requires a reviewed configuration change.
export const NATIVE_CATALOG_IMAGE_HOSTS = ["images.unsplash.com"] as const;

export function isNativeCatalogImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && !url.username && !url.password && !url.port && !url.hash
      && NATIVE_CATALOG_IMAGE_HOSTS.some((host) => host === url.hostname);
  } catch {
    return false;
  }
}
