import { describe, expect, it, vi } from "vitest";
import { checkMessage, notificationCheckSettings, verifyNotificationDelivery } from "./verify-notification-delivery.mjs";

const env = {
  NOTIFICATION_EMAIL_FROM: "BLOOM BOX <orders@mail.example.jp>",
  NOTIFICATION_TEST_RECIPIENT: "operator@example.jp",
  RESEND_API_KEY: "re_abcdefghijklmnop1234",
  NOTIFICATION_API_URL: "https://mail.example/emails",
};
const accepted = () => new Response(JSON.stringify({ id: "msg_123" }), { status: 200 });

describe("notificationCheckSettings", () => {
  it("accepts a named or bare sender with an explicit recipient", () => {
    expect(notificationCheckSettings(env)).toMatchObject({ from: env.NOTIFICATION_EMAIL_FROM, recipient: "operator@example.jp" });
    expect(notificationCheckSettings({ ...env, NOTIFICATION_EMAIL_FROM: "orders@mail.example.jp" }).from).toBe("orders@mail.example.jp");
  });

  it.each([
    ["NOTIFICATION_TEST_RECIPIENT", ""],
    ["NOTIFICATION_TEST_RECIPIENT", "not-an-email"],
    ["NOTIFICATION_EMAIL_FROM", "BLOOM BOX"],
    ["NOTIFICATION_EMAIL_FROM", "orders@mail.example.jp\r\nBcc: someone@example.jp"],
    ["RESEND_API_KEY", "sk_live_wrong"],
    ["NOTIFICATION_EMAIL_REPLY_TO", "not-an-email"],
  ])("refuses to send with an invalid %s", (name, value) => {
    expect(() => notificationCheckSettings({ ...env, [name]: value })).toThrow();
  });
});

describe("verifyNotificationDelivery", () => {
  it("sends one recognisable check message and reports the provider's id", async () => {
    const fetcher = vi.fn().mockResolvedValue(accepted());
    const log = vi.fn();
    const result = await verifyNotificationDelivery(env, { fetcher, log });
    expect(result).toMatchObject({ sent: true, id: "msg_123" });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe(env.NOTIFICATION_API_URL);
    expect(init.headers).toMatchObject({ Authorization: "Bearer re_abcdefghijklmnop1234", "Idempotency-Key": result.reference });
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ from: env.NOTIFICATION_EMAIL_FROM, to: ["operator@example.jp"], ...checkMessage(result.reference) });
    expect(body.text).toContain("お客様への通知ではありません");
    expect(log.mock.calls.flat().join("\n")).not.toContain("re_abcdefghijklmnop1234");
  });

  it("shows the message without sending on a dry run", async () => {
    const fetcher = vi.fn();
    expect(await verifyNotificationDelivery(env, { fetcher, log: () => {}, dryRun: true })).toMatchObject({ sent: false });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    [401, /API key/],
    [422, /sending domain/],
    [500, /HTTP 500/],
  ])("explains a provider rejection with status %i", async (status, expected) => {
    const fetcher = vi.fn().mockResolvedValue(new Response("{\"message\":\"private detail\"}", { status }));
    await expect(verifyNotificationDelivery(env, { fetcher, log: () => {} })).rejects.toThrow(expected);
  });

  it("never leaks the key or the provider's response when the request fails", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("connect failed for re_abcdefghijklmnop1234"));
    const error = await verifyNotificationDelivery(env, { fetcher, log: () => {} }).catch((caught) => caught);
    expect(String(error.message)).toBe("The mail provider could not be reached");
  });
});
