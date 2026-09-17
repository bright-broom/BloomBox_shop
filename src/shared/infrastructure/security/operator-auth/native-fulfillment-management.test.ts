import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { changeNativeFulfillment, readNativeFulfillment, readNativeFulfillments } from "./native-fulfillment-management";
import { loadNativeFulfillmentDatabaseConfig } from "../../config/database-config";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), database: vi.fn(), transaction: vi.fn(), list: vi.fn(), read: vi.fn(), facts: vi.fn(), previous: vi.fn(), record: vi.fn() }));
vi.mock("./operator-auth", () => ({ getOperatorAuth: mocks.auth }));
vi.mock("../../database/database-connections", () => ({ getNativeFulfillmentDatabaseClient: mocks.database }));
vi.mock("./native-fulfillment-transaction", () => ({ withNativeFulfillmentOperator: mocks.transaction }));
vi.mock("../../config/data-protection-config", () => ({ loadDataProtectionConfig: () => ({ activeKeyId: "test", keys: new Map([["test", Buffer.alloc(32, 1)]]) }) }));
vi.mock("@/modules/fulfillment/infrastructure/postgres-native-fulfillment-store", () => ({
  PostgresNativeFulfillmentStore: class { list = mocks.list; read = mocks.read; lockFacts = mocks.facts; findChange = mocks.previous; record = mocks.record; },
}));
const operatorId = randomUUID(), fulfillmentId = randomUUID(), origin = "https://operators.example";
function service() { return { config: { origin, bindings: [{ subject: "verified-google-subject", operatorId }] },
  auth: { auth: async () => ({ user: { id: "verified-google-subject" }, expires: new Date(Date.now() + 60000).toISOString() }) } }; }
function form() {
  const result = new FormData();
  for (const [key, value] of Object.entries({ fulfillmentId, requestId: randomUUID(), expectedVersion: "3", action: "SHIP", carrier: "YAMATO", trackingNumber: "1234-5678-9012" })) result.set(key, value);
  return result;
}
beforeEach(() => {
  vi.resetAllMocks(); mocks.auth.mockReturnValue(service());
  mocks.transaction.mockImplementation(async (_sql, _actor, work) => work({}));
  mocks.facts.mockResolvedValue({ fulfillmentId, status: "READY", version: 3, orderStatus: "CONFIRMED", paymentStatuses: ["CAPTURED"], itemQuantity: 1, hasShipment: false });
  mocks.previous.mockResolvedValue(null);
  mocks.record.mockResolvedValue({ fulfillmentId, status: "SHIPPED", version: 4 });
});
describe("native fulfillment authenticated input boundary", () => {
  it.each([null, "https://evil.example", "https://operators.example.evil.test", "null"])("denies origin %s before opening its dedicated connection", async (value) => {
    await expect(changeNativeFulfillment(form(), value)).rejects.toMatchObject({ code: "DENIED" });
    expect(mocks.database).not.toHaveBeenCalled(); expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("denies disabled auth for reads and writes before database access", async () => {
    mocks.auth.mockReturnValue(null);
    await expect(readNativeFulfillments({ status: null, after: null })).rejects.toMatchObject({ code: "DENIED" });
    await expect(readNativeFulfillment("invalid-id")).rejects.toMatchObject({ code: "DENIED" });
    await expect(changeNativeFulfillment(form(), origin)).rejects.toMatchObject({ code: "DENIED" });
    expect(mocks.database).not.toHaveBeenCalled();
  });
  it("rejects unbound subjects and expired sessions instead of treating Google login as a grant", async () => {
    const unbound = service(); unbound.config.bindings = []; mocks.auth.mockReturnValue(unbound);
    await expect(changeNativeFulfillment(form(), origin)).rejects.toMatchObject({ code: "DENIED" });
    const expired = service(); expired.auth.auth = async () => ({ user: { id: "verified-google-subject" }, expires: new Date(0).toISOString() }); mocks.auth.mockReturnValue(expired);
    await expect(readNativeFulfillments({ status: null, after: null })).rejects.toMatchObject({ code: "DENIED" });
    expect(mocks.database).not.toHaveBeenCalled();
  });
  it("uses only the verified operator, normalized command and preserved retry identifier", async () => {
    const input = form(); input.set("$ACTION_ID_framework", "opaque framework metadata");
    expect(await changeNativeFulfillment(input, origin)).toMatchObject({ status: "SHIPPED", version: 4 });
    expect(mocks.transaction.mock.calls[0][1]).toMatchObject({ operatorId });
    expect(mocks.record).toHaveBeenCalledWith(expect.objectContaining({ command: expect.objectContaining({ requestId: input.get("requestId"), expectedVersion: 3, trackingNumber: "123456789012" }) }), expect.objectContaining({ operatorId }));
  });
  it.each(["duplicate", "actor", "fraction", "exponent", "blank", "unsafe", "file", "extra", "date", "carrier"])("rejects %s input without entering an authorized write transaction", async (kind) => {
    const input = form();
    if (kind === "duplicate") input.append("requestId", randomUUID());
    if (kind === "actor") input.set("operatorId", randomUUID());
    if (kind === "fraction") input.set("expectedVersion", "1.5");
    if (kind === "exponent") input.set("expectedVersion", "1e3");
    if (kind === "blank") input.set("expectedVersion", "");
    if (kind === "unsafe") input.set("expectedVersion", String(Number.MAX_SAFE_INTEGER));
    if (kind === "file") input.set("trackingNumber", new Blob(["123456789012"]));
    if (kind === "extra") input.set("authorized", "true");
    if (kind === "date") input.set("shippedAt", "2026-09-01");
    if (kind === "carrier") input.set("carrier", "OTHER");
    await expect(changeNativeFulfillment(input, origin)).rejects.toMatchObject({ code: "INVALID" });
    expect(mocks.transaction).not.toHaveBeenCalled(); expect(mocks.record).not.toHaveBeenCalled();
  });
  it("bounds read inputs and validates UUIDs before invoking the store", async () => {
    await expect(readNativeFulfillments({ status: null, after: "x".repeat(201) })).rejects.toMatchObject({ code: "INVALID" });
    await expect(readNativeFulfillment("invalid-id")).rejects.toMatchObject({ code: "INVALID" });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("requires dedicated fulfillment credentials and does not reuse another privilege", () => {
    const other = { DATABASE_URL: "postgres://localhost/app", DATABASE_CATALOG_MANAGER_URL: "postgres://localhost/catalog", DATABASE_CUSTOMER_SUPPORT_URL: "postgres://localhost/support" };
    expect(() => loadNativeFulfillmentDatabaseConfig(other)).toThrow("Database configuration is invalid");
    expect(loadNativeFulfillmentDatabaseConfig({ ...other, DATABASE_NATIVE_FULFILLMENT_URL: "postgres://localhost/fulfillment" }).url).toBe("postgres://localhost/fulfillment");
  });
});
