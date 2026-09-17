import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("finance CLI fail-closed configuration", () => {
  it.each([
    {},
    { DATABASE_FINANCE_REPORT_URL: "postgresql://private:private@127.0.0.1/test", DATABASE_FINANCE_REPORT_SSL: "disable", STRIPE_ACCOUNT_ID: "acct_synthetic", STRIPE_MODE: "test", STRIPE_FINANCE_READ_KEY: "rk_live_syntheticsecret" },
    { DATABASE_FINANCE_REPORT_URL: "postgresql://private:private@remote.example.test/test", DATABASE_FINANCE_REPORT_SSL: "disable", STRIPE_ACCOUNT_ID: "acct_synthetic", STRIPE_MODE: "test", STRIPE_FINANCE_READ_KEY: "rk_test_syntheticsecret" },
  ])("rejects missing, cross-mode or unencrypted remote configuration without leaking it", (environment) => {
    const result = spawnSync(process.execPath, ["scripts/finance-reconciliation.mjs"], { env: environment, encoding: "utf8", timeout: 5000 });
    expect(result.status).toBe(1); expect(result.stdout).toBe("");
    expect(result.stderr).toContain("設定"); expect(result.stderr).not.toContain("syntheticsecret"); expect(result.stderr).not.toContain("private:private");
  });
});
