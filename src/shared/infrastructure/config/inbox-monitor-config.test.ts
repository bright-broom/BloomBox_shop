import { describe, expect, it } from "vitest";
import { InvalidInboxMonitorConfigurationError, loadInboxMonitorConfig } from "./inbox-monitor-config";

describe("isolated Inbox monitor configuration", () => {
  it("uses only the dedicated credential and verified TLS by default", () => {
    expect(loadInboxMonitorConfig({ DATABASE_INBOX_MONITOR_URL: "postgres://monitor:secret@db.example.test/bloombox" }))
      .toEqual({ url: "postgres://monitor:secret@db.example.test/bloombox", ssl: "verify-full" });
    expect(loadInboxMonitorConfig({ DATABASE_INBOX_MONITOR_URL: "postgres://monitor@127.0.0.1/bloombox_test", DATABASE_SSL_MODE: "disable" }).ssl).toBe(false);
  });
  it.each([
    {}, { DATABASE_URL: "postgres://worker@localhost/test" }, { DATABASE_WORKER_URL: "postgres://worker@localhost/test" },
    { DATABASE_INBOX_MONITOR_URL: "not a URL" }, { DATABASE_INBOX_MONITOR_URL: "https://db.example.test/test" },
    { DATABASE_INBOX_MONITOR_URL: "postgres://db.example.test" },
    { DATABASE_INBOX_MONITOR_URL: "postgres://db.example.test/test?sslmode=disable" },
    { DATABASE_INBOX_MONITOR_URL: "postgres://db.example.test/test#fragment" },
    { DATABASE_INBOX_MONITOR_URL: "postgres://db.example.test/test", DATABASE_SSL_MODE: "disable" },
    { DATABASE_INBOX_MONITOR_URL: "postgres://localhost/test", DATABASE_SSL_MODE: "require" },
  ])("rejects unsafe or missing configuration without echoing it: %#", (environment) => {
    expect(() => loadInboxMonitorConfig(environment)).toThrow(InvalidInboxMonitorConfigurationError);
    expect(() => loadInboxMonitorConfig(environment)).toThrow("Inbox monitor configuration is invalid");
  });
});
