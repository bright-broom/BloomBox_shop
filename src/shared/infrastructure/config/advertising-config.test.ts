import { describe, expect, it } from "vitest";
import { loadAdvertisingConfig } from "./advertising-config";
describe("advertising environment", () => {
  it("defaults off even when leftover credentials exist", () => { expect(loadAdvertisingConfig({ AD_META_PIXEL_ID: "invalid" }).enabled).toBe(false); });
  it("requires complete destination credentials and HTTPS in live mode", () => {
    expect(() => loadAdvertisingConfig({ BLOOMBOX_ADVERTISING_ENABLED: "true", BLOOMBOX_RUNTIME_MODE: "production", BLOOMBOX_PUBLIC_ORIGIN: "https://shop.example", AD_META_PIXEL_ID: "123" })).toThrow();
    expect(() => loadAdvertisingConfig({ BLOOMBOX_ADVERTISING_ENABLED: "true", BLOOMBOX_RUNTIME_MODE: "production", BLOOMBOX_PUBLIC_ORIGIN: "http://shop.example" })).toThrow();
  });
  it("allows UI-only local previews without credentials", () => {
    expect(loadAdvertisingConfig({ BLOOMBOX_ADVERTISING_ENABLED: "true", BLOOMBOX_PUBLIC_ORIGIN: "http://localhost:3041" })).toMatchObject({ enabled: true, live: false });
  });
  it("rejects webhook credentials in URLs and invalid enabled flags", () => {
    expect(() => loadAdvertisingConfig({ BLOOMBOX_ADVERTISING_ENABLED: "yes" })).toThrow();
    expect(() => loadAdvertisingConfig({ BLOOMBOX_ADVERTISING_ENABLED: "true", BLOOMBOX_PUBLIC_ORIGIN: "https://shop.example", AD_WEBHOOK_URL: "https://user:pass@collector.example", AD_WEBHOOK_SECRET: "a".repeat(32) })).toThrow();
  });
});
