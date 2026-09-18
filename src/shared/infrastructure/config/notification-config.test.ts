import { describe, expect, it } from "vitest";
import { InvalidNotificationConfigurationError, loadNotificationConfig } from "./notification-config";

const valid = {
  BLOOMBOX_NOTIFICATIONS_ENABLED: "true",
  BLOOMBOX_RUNTIME_MODE: "production",
  BLOOMBOX_PUBLIC_ORIGIN: "https://shop.example",
  NOTIFICATION_EMAIL_FROM: "BLOOM BOX <orders@shop.example>",
  RESEND_API_KEY: "re_abcdefghijklmnop1234",
};

describe("loadNotificationConfig", () => {
  it.each([{}, { BLOOMBOX_NOTIFICATIONS_ENABLED: "false" }, { BLOOMBOX_NOTIFICATIONS_ENABLED: "" }])("is off by default: %j", (environment) => {
    expect(loadNotificationConfig(environment)).toEqual({ enabled: false });
  });

  it("sends live only from the production runtime", () => {
    expect(loadNotificationConfig(valid)).toMatchObject({ enabled: true, live: true, origin: "https://shop.example", from: valid.NOTIFICATION_EMAIL_FROM });
    expect(loadNotificationConfig({ ...valid, BLOOMBOX_RUNTIME_MODE: "preview" })).toMatchObject({ enabled: true, live: false });
  });

  it.each([
    { BLOOMBOX_NOTIFICATIONS_ENABLED: "yes" },
    { RESEND_API_KEY: "sk_live_wrong" },
    { NOTIFICATION_EMAIL_FROM: "orders@shop.example\r\nBcc: x@example.test" },
    { NOTIFICATION_EMAIL_FROM: "BLOOM BOX" },
    { BLOOMBOX_PUBLIC_ORIGIN: "http://shop.example" },
    { BLOOMBOX_PUBLIC_ORIGIN: "https://shop.example/path" },
    { NOTIFICATION_EMAIL_REPLY_TO: "not-an-email" },
  ])("rejects an unsafe setting: %j", (override) => {
    expect(() => loadNotificationConfig({ ...valid, ...override })).toThrow(InvalidNotificationConfigurationError);
  });

  it("accepts a bare sender address", () => {
    expect(loadNotificationConfig({ ...valid, NOTIFICATION_EMAIL_FROM: "orders@shop.example" })).toMatchObject({ enabled: true });
  });
});
