import { beforeEach, describe, expect, it, vi } from "vitest";
import { readOperatorReview } from "./read-operator-review";
const mocks = vi.hoisted(() => ({ getAuth: vi.fn(), database: vi.fn(), find: vi.fn(), construct: vi.fn() }));
vi.mock("./operator-auth", () => ({ getOperatorAuth: mocks.getAuth }));
vi.mock("../../database/database-connections", () => ({ getOperatorDatabaseClient: mocks.database }));
vi.mock("@/modules/fulfillment/infrastructure/postgres-fulfillment-review-query", () => ({
  PostgresFulfillmentReviewQuery: class { constructor(...args: unknown[]) { mocks.construct(...args); } find = mocks.find; },
}));
const subject = "12345", operatorId = "00000000-0000-4000-8000-000000000001";
const input = { shop: "example.myshopify.com", fulfillmentId: "00000000-0000-4000-8000-000000000002" };
beforeEach(() => { vi.resetAllMocks(); });
describe("operator review composition", () => {
  it("does not initialize a database without enabled authentication, a session, and an explicit identity binding", async () => {
    for (const service of [null,
      { config: { bindings: [] }, auth: { auth: async () => null } },
      { config: { bindings: [] }, auth: { auth: async () => ({ user: { id: subject }, expires: new Date(Date.now() + 60_000).toISOString() }) } }]) {
      mocks.getAuth.mockReturnValue(service);
      await expect(readOperatorReview(input)).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
    }
    expect(mocks.database).not.toHaveBeenCalled(); expect(mocks.find).not.toHaveBeenCalled();
  });
  it("passes the mapped identity and configured payment mode to the permission-checking query", async () => {
    const expiresAt = new Date(Date.now() + 60_000);
    mocks.getAuth.mockReturnValue({ config: { bindings: [{ subject, operatorId }], testMode: true },
      auth: { auth: async () => ({ user: { id: subject }, expires: expiresAt.toISOString() }) } });
    const db = {}; mocks.database.mockReturnValue(db); mocks.find.mockResolvedValue(null);
    expect(await readOperatorReview(input)).toBeNull();
    expect(mocks.construct).toHaveBeenCalledWith(db, true, expect.anything());
    const identity = mocks.construct.mock.calls[0][2];
    expect(await identity.current()).toEqual({ operatorId, expiresAt });
    expect(mocks.find).toHaveBeenCalledWith(input);
    mocks.find.mockRejectedValue(new Error("query failure"));
    await expect(readOperatorReview(input)).rejects.toThrow("query failure");
  });
});
