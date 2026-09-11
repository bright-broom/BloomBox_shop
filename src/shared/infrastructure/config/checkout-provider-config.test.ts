import { describe, expect, it } from "vitest";
import {
  InvalidCheckoutProviderConfigurationError,
  loadCheckoutIntakeEnabled,
  loadCheckoutProviderMode,
} from "./checkout-provider-config";

describe("checkout intake configuration", () => {
  it("preserves the existing default and accepts explicit enable/disable values", () => {
    expect(loadCheckoutIntakeEnabled({})).toBe(true);
    expect(loadCheckoutIntakeEnabled({ BLOOMBOX_CHECKOUT_INTAKE_ENABLED: "true" })).toBe(true);
    expect(loadCheckoutIntakeEnabled({ BLOOMBOX_CHECKOUT_INTAKE_ENABLED: "false" })).toBe(false);
  });

  it.each(["", "0", "1", "FALSE", " true ", "yes"])("rejects ambiguous value %j", (value) => {
    expect(() => loadCheckoutIntakeEnabled({ BLOOMBOX_CHECKOUT_INTAKE_ENABLED: value }))
      .toThrow(InvalidCheckoutProviderConfigurationError);
  });

  it.each(["false", "invalid"])("does not disable the provider when intake is %s", (value) => {
    expect(loadCheckoutProviderMode({
      BLOOMBOX_CHECKOUT_PROVIDER: "stripe",
      BLOOMBOX_CHECKOUT_INTAKE_ENABLED: value,
    })).toBe("stripe");
  });
});
