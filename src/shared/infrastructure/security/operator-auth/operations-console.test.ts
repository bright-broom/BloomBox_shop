import { beforeEach, describe, it, expect, vi } from "vitest";
import { getCustomerSupportDatabaseClient } from "../../database/database-connections";
import {
  openOperatorOrders,
  openOperatorReport,
  operatorOrderInput,
  operatorReportInput,
} from "./operations-console";
import { operationsConsoleSettings } from "../../config/operations-console-config";
import { consoleResource } from "./console-resource";
import { CustomerManagementError } from "@/modules/customer/public";
const mocks = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("./operator-auth", () => ({ getOperatorAuth: mocks.auth }));
vi.mock("../../database/database-connections", () => ({
  getCustomerSupportDatabaseClient: vi.fn(),
}));
beforeEach(() => vi.resetAllMocks());
describe("operations console security", () => {
  it("rejects absent, unbound and expired identities before opening any connection", async () => {
    for (const service of [
      null,
      { config: { bindings: [{ subject: "verified", operatorId: "00000000-0000-4000-8000-000000000001" }] },
        auth: { auth: async () => ({user:{id:"verified"}, expires:new Date(0).toISOString()}) } },
      {
        config: { bindings: [] },
        auth: {
          auth: async () => ({
            user: { id: "verified" },
            expires: new Date(Date.now() + 60000).toISOString(),
          }),
        },
      },
    ]) {
      mocks.auth.mockReturnValue(service);
      await expect(openOperatorOrders({})).rejects.toMatchObject({
        code: "DENIED",
      });
      await expect(openOperatorReport({})).rejects.toMatchObject({
        code: "DENIED",
      });
    }
    expect(getCustomerSupportDatabaseClient).not.toHaveBeenCalled();
  });
  it("rejects injected filters, duplicate values, contact data and unbounded periods", () => {
    for (const input of [
      { q: "x@example.test" },
      { q: "' OR 1=1" },
      { status: ["CONFIRMED"] },
      { operatorId: "forged" },
      { after: "bad" },
      { payment: "PAID" },
      { q: "x".repeat(101) },
    ])
      expect(operatorOrderInput.safeParse(input).success).toBe(false);
    for (const input of [
      { days: "365" },
      { days: ["30"] },
      { days: "0" },
      { secret: "x" },
    ])
      expect(operatorReportInput.safeParse(input).success).toBe(false);
    expect(operatorOrderInput.parse({ q: " BB-1 " })).toEqual({ q: "BB-1" });
    expect(operatorReportInput.parse({})).toEqual({ days: "30" });
  });
  it("projects configuration status only without secrets or implied live readiness", () => {
    const env = {
      BLOOMBOX_RUNTIME_MODE: "preview",
      DATABASE_URL: "postgres://owner:SECRET@localhost/app",
      DATABASE_CATALOG_MANAGER_URL: "postgres://role:SECRET@localhost/catalog",
      DATABASE_NATIVE_FULFILLMENT_URL: "broken-private",
    };
    const result = operationsConsoleSettings(env);
    expect(result.connections).toEqual({
      catalog: "configured",
      support: "notConfigured",
      fulfillment: "invalidConfig",
    });
    expect(JSON.stringify(result)).not.toMatch(
      /SECRET|postgres|localhost|broken-private/,
    );
    expect(result.advertising).toBe("adsDisabled");
  });
  it("never treats a failure as zero orders or discloses provider errors", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(
      await consoleResource(async () => {
        throw new CustomerManagementError("DENIED");
      }),
    ).toEqual({ status: "denied" });
    expect(
      await consoleResource(async () => {
        throw new Error("PRIVATE DATABASE");
      }),
    ).toEqual({ status: "unavailable" });
    expect(JSON.stringify(spy.mock.calls)).not.toContain("PRIVATE");
    spy.mockRestore();
  });
});
