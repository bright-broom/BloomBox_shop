import { describe, expect, it } from "vitest";
import {
  InvalidSiteUrlConfigurationError,
  loadSiteUrlConfig,
} from "./site-url-config";

describe("loadSiteUrlConfig", () => {
  it("uses a local origin only for preview", () => {
    expect(loadSiteUrlConfig({ BLOOMBOX_RUNTIME_MODE: "preview" }).origin)
      .toBe("http://localhost:3000");
    expect(() => loadSiteUrlConfig({
      BLOOMBOX_RUNTIME_MODE: "production",
      BLOOMBOX_PUBLIC_ORIGIN: "http://localhost:3000",
    })).toThrow(InvalidSiteUrlConfigurationError);
  });

  it("normalizes a secure production origin", () => {
    expect(loadSiteUrlConfig({
      BLOOMBOX_RUNTIME_MODE: "production",
      BLOOMBOX_PUBLIC_ORIGIN: "https://shop.example.com/path",
    }).origin).toBe("https://shop.example.com");
  });
});
