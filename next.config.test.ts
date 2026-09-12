import { describe, expect, it } from "vitest";
import config from "./next.config";

describe("operator form privacy headers", () => {
  it("preserves native form Origin while suppressing cross-origin Referer", async () => {
    const rules = await config.headers!();
    const operations = rules.find((rule) => rule.source === "/operations/:path*");
    expect(operations?.headers).toEqual(expect.arrayContaining([
      { key: "Referrer-Policy", value: "same-origin" },
      { key: "Cache-Control", value: "private, no-store, max-age=0" },
      { key: "X-Robots-Tag", value: "noindex, nofollow" },
    ]));
    expect(config.experimental?.serverActions ?? {}).not.toHaveProperty("allowedOrigins");
  });

  it.each(["/api/operator-auth/:path*", "/checkout/:path*"])("retains no-referrer for %s", async (source) => {
    const rules = await config.headers!();
    expect(rules.find((rule) => rule.source === source)?.headers).toContainEqual({
      key: "Referrer-Policy", value: "no-referrer",
    });
  });
});
