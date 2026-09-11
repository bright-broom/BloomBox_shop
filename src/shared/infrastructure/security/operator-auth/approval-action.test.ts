import { beforeEach, describe, expect, it, vi } from "vitest";
import { FulfillmentApprovalError } from "@/modules/fulfillment/public";
import { recordFulfillmentApproval } from "@/app/operations/fulfillments/actions";
const mocks = vi.hoisted(() => ({ record: vi.fn(), headers: vi.fn(), revalidate: vi.fn() }));
vi.mock("./operator-approval", () => ({ recordOperatorApproval: mocks.record }));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
beforeEach(() => { vi.resetAllMocks(); mocks.headers.mockResolvedValue(new Headers({ origin: "https://operators.example" })); });
describe("approval server action", () => {
  it("ignores caller state and returns only the actual receipt outcome after refreshing its verified path", async () => {
    const form = new FormData();
    mocks.record.mockResolvedValue({ receipt: { outcome: "DUPLICATE", approvalId: "private-internal-id" }, reviewPath: "/operations/fulfillments/verified/target" });
    expect(await recordFulfillmentApproval({ status: "RECORDED" }, form)).toEqual({ status: "DUPLICATE" });
    expect(mocks.record).toHaveBeenCalledWith(form, "https://operators.example");
    expect(mocks.revalidate).toHaveBeenCalledWith("/operations/fulfillments/verified/target");
  });
  it.each(["INVALID_REQUEST", "NOT_AUTHORIZED", "REVIEW_REQUIRED", "CONFLICT", "UNAVAILABLE"] as const)("translates %s without falsely refreshing or claiming success", async (code) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.record.mockRejectedValue(new FulfillmentApprovalError(code));
    expect(await recordFulfillmentApproval({ status: "RECORDED" }, new FormData())).toEqual({ status: code });
    expect(mocks.revalidate).not.toHaveBeenCalled(); log.mockRestore();
  });
  it("does not leak unexpected diagnostics or turn a committed record into failure if refresh fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.record.mockRejectedValueOnce(new Error("PRIVATE_DB_CREDENTIAL"));
    expect(await recordFulfillmentApproval({ status: "IDLE" }, new FormData())).toEqual({ status: "UNAVAILABLE" });
    expect(log).toHaveBeenCalledWith("operator_approval_unavailable");
    mocks.record.mockResolvedValue({ receipt: { outcome: "RECORDED" }, reviewPath: "/verified" });
    mocks.revalidate.mockImplementation(() => { throw new Error("PRIVATE_REFRESH_DETAIL"); });
    expect(await recordFulfillmentApproval({ status: "IDLE" }, new FormData())).toEqual({ status: "RECORDED" });
    expect(log).toHaveBeenCalledWith("operator_approval_refresh_unavailable");
    expect(JSON.stringify(log.mock.calls)).not.toContain("PRIVATE"); log.mockRestore();
  });
});
