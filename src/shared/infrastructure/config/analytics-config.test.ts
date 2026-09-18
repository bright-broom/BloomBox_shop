import { describe, expect, it, vi } from "vitest";
import { analyticsSettingsOrDisabled, InvalidAnalyticsConfigurationError, loadAnalyticsConfig } from "./analytics-config";

describe("loadAnalyticsConfig", () => {
  it.each([{}, { BLOOMBOX_GA4_MEASUREMENT_ID: "" }])("is disabled without a measurement ID: %j", (environment) => {
    expect(loadAnalyticsConfig(environment)).toEqual({ enabled: false });
  });

  it("accepts a GA4 measurement ID and builds the tag URL", () => {
    expect(loadAnalyticsConfig({ BLOOMBOX_GA4_MEASUREMENT_ID: "G-ABC123XYZ9" })).toEqual({
      enabled: true, measurementId: "G-ABC123XYZ9", scriptUrl: "https://www.googletagmanager.com/gtag/js?id=G-ABC123XYZ9",
    });
  });

  it.each(["UA-12345-1", "G-abc123", "G-ABC", "G-ABC123&x=1", " G-ABC123"])("rejects %j", (id) => {
    expect(() => loadAnalyticsConfig({ BLOOMBOX_GA4_MEASUREMENT_ID: id })).toThrow(InvalidAnalyticsConfigurationError);
  });

  it("disables analytics and reports an invalid configuration instead of breaking pages", () => {
    const report = vi.fn();
    expect(analyticsSettingsOrDisabled({ BLOOMBOX_GA4_MEASUREMENT_ID: "invalid" }, report)).toEqual({ enabled: false });
    expect(report).toHaveBeenCalledOnce();
  });
});
