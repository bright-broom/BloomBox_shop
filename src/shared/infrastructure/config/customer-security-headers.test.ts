import { describe, expect, it } from "vitest";
import nextConfig from "../../../../next.config";

describe("customer login browser policy", () => {
  it("allows the native form's Google redirect on account and auth routes without broadening other sources", async () => {
    const routes = await nextConfig.headers?.();
    for (const source of ["/account/:path*", "/api/customer-auth/:path*"]) {
      const route = routes?.find((item) => item.source === source);
      // Proxy owns the per-response CSP. Static route overrides must never replace it.
      expect(route?.headers.some((header) => header.key === "Content-Security-Policy")).toBe(false);
      expect(route?.headers).toContainEqual({ key: "Cache-Control", value: "private, no-store, max-age=0" });
      expect(route?.headers).toContainEqual({ key: "Referrer-Policy", value: source === "/account/:path*" ? "same-origin" : "no-referrer" });
    }
  });
});
