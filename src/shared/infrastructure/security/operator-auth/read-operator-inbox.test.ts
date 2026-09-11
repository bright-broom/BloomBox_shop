import { beforeEach, describe, expect, it, vi } from "vitest";
import { readOperatorInbox } from "./read-operator-inbox";
const mocks = vi.hoisted(() => ({ getAuth: vi.fn(), database: vi.fn(), list: vi.fn(), construct: vi.fn() }));
vi.mock("./operator-auth", () => ({ getOperatorAuth: mocks.getAuth }));
vi.mock("../../database/database-connections", () => ({ getOperatorDatabaseClient: mocks.database }));
vi.mock("@/modules/fulfillment/infrastructure/postgres-fulfillment-inbox-query", () => ({
  PostgresFulfillmentInboxQuery: class { constructor(...args: unknown[]) { mocks.construct(...args); } list = mocks.list; },
}));
const subject = "12345", operatorId = "00000000-0000-4000-8000-000000000001";
const input = { shop: "example.myshopify.com" };
beforeEach(() => { vi.resetAllMocks(); });
describe("operator inbox composition", () => {
  it("does not initialize a database without enabled authentication, a session, and an explicit identity binding", async () => {
    for (const service of [null,
      { config: { bindings: [] }, auth: { auth: async () => null } },
      { config: { bindings: [] }, auth: { auth: async () => ({ user: { id: subject }, expires: new Date(Date.now() + 60_000).toISOString() }) } }]) {
      mocks.getAuth.mockReturnValue(service);
      await expect(readOperatorInbox(input)).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
    }
    expect(mocks.database).not.toHaveBeenCalled(); expect(mocks.list).not.toHaveBeenCalled();
  });
  it("passes the mapped identity and configured payment mode to the permission-checking query", async () => {
    const expiresAt = new Date(Date.now() + 60_000);
    mocks.getAuth.mockReturnValue({ config: { bindings: [{ subject, operatorId }], testMode: true },
      auth: { auth: async () => ({ user: { id: subject }, expires: expiresAt.toISOString() }) } });
    const db = {}; mocks.database.mockReturnValue(db); mocks.list.mockResolvedValue(null);
    expect(await readOperatorInbox(input)).toBeNull();
    expect(mocks.construct).toHaveBeenCalledWith(db, true, expect.anything());
    const identity = mocks.construct.mock.calls[0][2];
    expect(await identity.current()).toEqual({ operatorId, expiresAt });
    expect(mocks.list).toHaveBeenCalledWith(input);
    mocks.list.mockRejectedValue(new Error("query failure"));
    await expect(readOperatorInbox(input)).rejects.toThrow("query failure");
  });
});
