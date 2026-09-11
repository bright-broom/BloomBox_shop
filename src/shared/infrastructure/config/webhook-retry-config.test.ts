import { describe, expect, it } from "vitest";
import { InvalidWebhookRetryConfigurationError, loadWebhookRetryConfig } from "./webhook-retry-config";

describe("webhook recovery credential boundary", () => {
  it("requires a dedicated credential and defaults to verified TLS", () => {
    expect(loadWebhookRetryConfig({ DATABASE_WEBHOOK_ADMIN_URL: "postgres://owner:secret@db.example.test/bloombox" }))
      .toEqual({ url: "postgres://owner:secret@db.example.test/bloombox", ssl: "verify-full" });
    expect(loadWebhookRetryConfig({ DATABASE_WEBHOOK_ADMIN_URL: "postgres://owner@127.0.0.1/test", DATABASE_SSL_MODE: "disable" }).ssl).toBe(false);
  });
  it.each([
    {}, { DATABASE_URL: "postgres://owner@localhost/test" }, { DATABASE_WORKER_URL: "postgres://worker@localhost/test" },
    { DATABASE_OPERATOR_ADMIN_URL: "postgres://owner@localhost/test" },
    { DATABASE_WEBHOOK_ADMIN_URL: "invalid" }, { DATABASE_WEBHOOK_ADMIN_URL: "https://db.example.test/test" },
    { DATABASE_WEBHOOK_ADMIN_URL: "postgres://db.example.test" },
    { DATABASE_WEBHOOK_ADMIN_URL: "postgres://db.example.test/test?sslmode=disable" },
    { DATABASE_WEBHOOK_ADMIN_URL: "postgres://db.example.test/test#fragment" },
    { DATABASE_WEBHOOK_ADMIN_URL: "postgres://db.example.test/test", DATABASE_SSL_MODE: "disable" },
    { DATABASE_WEBHOOK_ADMIN_URL: "postgres://localhost/test", DATABASE_SSL_MODE: "require" },
  ])("rejects missing or unsafe configuration without echoing it: %#", (environment) => {
    expect(() => loadWebhookRetryConfig(environment)).toThrow(InvalidWebhookRetryConfigurationError);
    expect(() => loadWebhookRetryConfig(environment)).toThrow("Webhook retry configuration is invalid");
  });
});
