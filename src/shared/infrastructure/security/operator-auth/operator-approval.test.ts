import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FulfillmentApprovalError, type FulfillmentReview } from "@/modules/fulfillment/public";
import { prepareOperatorApproval, recordOperatorApproval } from "./operator-approval";
const mocks = vi.hoisted(() => ({ service: vi.fn(), database: vi.fn(), find: vi.fn(), approve: vi.fn(),
  construct: vi.fn(), consume: vi.fn(), limiter: vi.fn(), policy: { approval: "APPROVED" } }));
vi.mock("./operator-auth", () => ({ getOperatorAuth: mocks.service }));
vi.mock("../../database/database-connections", () => ({ getOperatorDatabaseClient: mocks.database }));
vi.mock("@/modules/fulfillment/public", async (original) => ({ ...await original<typeof import("@/modules/fulfillment/public")>(), FULFILLMENT_INTAKE_POLICY: mocks.policy }));
vi.mock("@/modules/fulfillment/infrastructure/postgres-fulfillment-review-query", () => ({
  PostgresFulfillmentReviewQuery: class { find = mocks.find; },
}));
vi.mock("@/modules/fulfillment/infrastructure/postgres-shopify-fulfillment-approver", () => ({
  PostgresShopifyFulfillmentApprover: class { constructor(...args: unknown[]) { mocks.construct(...args); } approve = mocks.approve; },
}));
vi.mock("@/modules/fulfillment/infrastructure/postgres-approval-submission-limiter", () => ({
  PostgresApprovalSubmissionLimiter: class { constructor(...args: unknown[]) { mocks.limiter(...args); } consume = mocks.consume; },
}));
const origin = "https://operators.example";
const target = { shop: "example.myshopify.com", fulfillmentId: "00000000-0000-4000-8000-000000000001" };
const operatorId = "00000000-0000-4000-8000-000000000002";
const review: FulfillmentReview = { ...target, orderId: "00000000-0000-4000-8000-000000000003", intakeVersion: 3,
  observedAt: "2026-09-12T00:00:00Z", viewedAt: "2026-09-12T00:00:00Z", deliveryDate: "2026-09-20",
  status: "UNFULFILLED", orderStatus: "CONFIRMED", reason: "DISPATCH_APPROVAL_REQUIRED", totalMinor: 5000,
  capturedMinor: 5000, refundedMinor: 0, paymentEvidenceCurrent: true, items: [{ name: "BLOOM BOX M", quantity: 1 }],
  stock: { status: "COVERED", reason: "COMMITMENTS_COVERED", checkedAt: "2026-09-12T00:00:00Z", expiresAt: "2026-09-12T00:00:30Z" },
  quantities: { status: "NONE", reason: "MATCHED", ordered: 1, shipped: 0, delivered: 0 }, latestApproval: null };
function form(token: string) { const value = new FormData(); value.set("intent", token); value.set("acknowledged", "yes"); return value; }
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(review.viewedAt));
  vi.resetAllMocks(); mocks.policy.approval = "APPROVED";
  const expires = new Date(Date.now() + 600000).toISOString();
  mocks.service.mockReturnValue({ config: { origin, secret: "synthetic-review-intent-secret-only", bindings: [{ subject: "12345", operatorId }], testMode: true },
    auth: { auth: async () => ({ user: { id: "12345" }, expires }) } });
  mocks.find.mockResolvedValue(review);
  mocks.approve.mockResolvedValue({ outcome: "RECORDED" }); mocks.consume.mockResolvedValue(undefined);
});
afterEach(() => { vi.useRealTimers(); });
describe("operator approval composition", () => {
  it("uses the earliest stock, session or encrypted intent deadline without accepting it from the browser", async () => {
    expect(await prepareOperatorApproval(target)).toMatchObject({ control: { status: "READY",
      preparedAt: new Date(review.viewedAt).toISOString(), expiresAt: new Date(review.stock.expiresAt!).toISOString() } });
    mocks.service().auth.auth = async () => ({ user: { id: "12345" }, expires: "2026-09-12T00:00:10.999Z" });
    expect(await prepareOperatorApproval(target)).toMatchObject({ control: { status: "READY", expiresAt: "2026-09-12T00:00:10.000Z" } });
    mocks.service().auth.auth = async () => ({ user: { id: "12345" }, expires: "2026-09-12T00:15:00.000Z" });
    mocks.find.mockResolvedValue({ ...review, stock: { ...review.stock, expiresAt: "2026-09-12T00:10:00.000Z" } });
    expect(await prepareOperatorApproval(target)).toMatchObject({ control: { status: "READY", expiresAt: "2026-09-12T00:05:00.000Z" } });
  });
  it.each([null, "invalid", "2026-09-12T00:00:00.000Z"])("does not issue a form when the display deadline is already unavailable: %s", async (expiresAt) => {
    mocks.find.mockResolvedValue({ ...review, stock: { ...review.stock, expiresAt } });
    expect(await prepareOperatorApproval(target)).toMatchObject({ control: { status: "REVIEW_REQUIRED", intent: null } });
  });
  it("uses only the encrypted server-reviewed target and idempotency key on repeated submissions", async () => {
    const page = await prepareOperatorApproval(target);
    if (!page?.control.intent) throw new Error("Expected prepared form");
    const submitted = form(page.control.intent);
    expect(await recordOperatorApproval(submitted, origin)).toMatchObject({ reviewPath: `/operations/fulfillments/${target.shop}/${target.fulfillmentId}`, receipt: { outcome: "RECORDED" } });
    const request = mocks.approve.mock.calls[0][0];
    expect(request).toMatchObject({ ...target, reviewedIntakeVersion: 3 });
    expect(request).not.toHaveProperty("operatorId");
    await recordOperatorApproval(submitted, origin); expect(mocks.approve.mock.calls[1][0]).toEqual(request);
    expect(await mocks.construct.mock.calls[0][2].current()).toMatchObject({ operatorId });
  });
  it("does not issue forms or reach the write adapter while merchant policy is pending", async () => {
    mocks.policy.approval = "PENDING";
    expect(await prepareOperatorApproval(target)).toMatchObject({ control: { status: "POLICY_PENDING", intent: null } });
    mocks.database.mockClear();
    await expect(recordOperatorApproval(form("forged"), origin)).rejects.toEqual(new FulfillmentApprovalError("REVIEW_REQUIRED"));
    expect(mocks.database).not.toHaveBeenCalled(); expect(mocks.approve).not.toHaveBeenCalled(); expect(mocks.consume).not.toHaveBeenCalled();
  });
  it("does not prepare actionable forms for changed evidence or existing approval", async () => {
    mocks.find.mockResolvedValueOnce({ ...review, paymentEvidenceCurrent: false });
    expect(await prepareOperatorApproval(target)).toMatchObject({ control: { status: "REVIEW_REQUIRED", intent: null } });
    mocks.find.mockResolvedValueOnce({ ...review, latestApproval: { intakeVersion: 3 } });
    expect(await prepareOperatorApproval(target)).toMatchObject({ control: { status: "RECORDED", intent: null } });
    mocks.find.mockResolvedValueOnce(null); expect(await prepareOperatorApproval(target)).toBeNull();
  });
  it("rejects wrong origins and missing authentication before initializing a connection", async () => {
    await expect(recordOperatorApproval(form("forged"), null)).rejects.toEqual(new FulfillmentApprovalError("NOT_AUTHORIZED"));
    await expect(recordOperatorApproval(form("forged"), "https://other.example")).rejects.toEqual(new FulfillmentApprovalError("NOT_AUTHORIZED"));
    const service = mocks.service();
    mocks.service.mockReturnValue({ ...service, config: { ...service.config, bindings: [] } });
    await expect(recordOperatorApproval(form("forged"), origin)).rejects.toEqual(new FulfillmentApprovalError("NOT_AUTHORIZED"));
    await expect(prepareOperatorApproval(target)).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
    mocks.service.mockReturnValue(null);
    await expect(recordOperatorApproval(form("forged"), origin)).rejects.toEqual(new FulfillmentApprovalError("NOT_AUTHORIZED"));
    await expect(prepareOperatorApproval(target)).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
    expect(mocks.database).not.toHaveBeenCalled(); expect(mocks.consume).not.toHaveBeenCalled();
  });
  it("rejects missing confirmation, duplicated fields and browser identity/target overrides", async () => {
    const page = await prepareOperatorApproval(target);
    if (!page?.control.intent) throw new Error("Expected prepared form");
    for (const mutate of [(value: FormData) => value.delete("acknowledged"), (value: FormData) => value.append("intent", "forged"),
      (value: FormData) => value.set("operatorId", operatorId), (value: FormData) => value.set("reviewedIntakeVersion", "999"),
      (value: FormData) => value.set("expiresAt", "2099-01-01T00:00:00.000Z")]) {
      const value = form(page.control.intent); mutate(value);
      await expect(recordOperatorApproval(value, origin)).rejects.toEqual(new FulfillmentApprovalError("INVALID_REQUEST"));
    }
    expect(mocks.approve).not.toHaveBeenCalled(); expect(mocks.consume).not.toHaveBeenCalled();
  });
  it.each(["RATE_LIMITED", "UNAVAILABLE"] as const)("never reaches approval after limiter %s", async (code) => {
    const page = await prepareOperatorApproval(target);
    if (!page?.control.intent) throw new Error("Expected prepared form");
    mocks.consume.mockRejectedValue(new FulfillmentApprovalError(code));
    await expect(recordOperatorApproval(form(page.control.intent), origin)).rejects.toEqual(new FulfillmentApprovalError(code));
    expect(mocks.approve).not.toHaveBeenCalled();
    expect(await mocks.limiter.mock.calls[0][1].current()).toMatchObject({ operatorId });
  });
  it("counts malformed intents and failed approval retries against the same authenticated identity", async () => {
    await expect(recordOperatorApproval(form("forged"), origin)).rejects.toMatchObject({ code: "REVIEW_REQUIRED" });
    expect(mocks.consume).toHaveBeenCalledTimes(1); expect(mocks.approve).not.toHaveBeenCalled();
    const page = await prepareOperatorApproval(target);
    if (!page?.control.intent) throw new Error("Expected prepared form");
    mocks.approve.mockRejectedValue(new FulfillmentApprovalError("REVIEW_REQUIRED"));
    for (let i = 0; i < 2; i++) await expect(recordOperatorApproval(form(page.control.intent), origin)).rejects.toMatchObject({ code: "REVIEW_REQUIRED" });
    expect(mocks.consume).toHaveBeenCalledTimes(3);
    expect(mocks.approve.mock.calls[0][0]).toEqual(mocks.approve.mock.calls[1][0]);
  });
});
