import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveNativeFulfillment } from "@/app/operations/native-fulfillments/actions";
import { NativeFulfillmentError } from "@/modules/fulfillment/public";
const mocks = vi.hoisted(() => ({ change: vi.fn(), headers: vi.fn(), refresh: vi.fn() }));
vi.mock("./native-fulfillment-management", () => ({ changeNativeFulfillment: mocks.change }));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.refresh }));
function confirmed() { const form = new FormData(); form.set("confirmed", "yes"); return form; }
beforeEach(() => { vi.resetAllMocks(); mocks.headers.mockResolvedValue(new Headers({ origin: "https://operators.example" })); });
afterEach(() => vi.restoreAllMocks());
describe("native fulfillment action confirmation and recovery", () => {
  it.each(["missing", "duplicate", "false"])("rejects %s confirmation without opening headers or writing", async (kind) => {
    const form = new FormData(); if (kind !== "missing") form.set("confirmed", kind === "false" ? "no" : "yes"); if (kind === "duplicate") form.append("confirmed", "yes");
    expect(await saveNativeFulfillment({ status: "IDLE" }, form)).toEqual({ status: "INVALID" });
    expect(mocks.change).not.toHaveBeenCalled(); expect(mocks.headers).not.toHaveBeenCalled();
  });
  it("passes the actual request origin and strips UI confirmation from the domain command", async () => {
    const form = confirmed(); expect(await saveNativeFulfillment({ status: "IDLE" }, form)).toEqual({ status: "SAVED" });
    expect(mocks.change).toHaveBeenCalledWith(form, "https://operators.example"); expect(form.has("confirmed")).toBe(false);
    expect(mocks.refresh).toHaveBeenCalledWith("/account/orders/[orderId]", "page");
  });
  it("keeps failed authorization/conflict distinct and does not refresh or claim success", async () => {
    for (const code of ["DENIED", "CONFLICT", "PAYMENT_NOT_SETTLED"] as const) {
      mocks.change.mockRejectedValueOnce(new NativeFulfillmentError(code));
      expect(await saveNativeFulfillment({ status: "IDLE" }, confirmed())).toEqual({ status: code });
    }
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("does not log private errors or reverse a committed result when refresh fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.change.mockRejectedValueOnce(new Error("PRIVATE_DATABASE_URL_AND_ADDRESS"));
    expect(await saveNativeFulfillment({ status: "IDLE" }, confirmed())).toEqual({ status: "UNAVAILABLE" });
    mocks.refresh.mockImplementation(() => { throw new Error("PRIVATE_TRACKING_REFERENCE"); });
    expect(await saveNativeFulfillment({ status: "IDLE" }, confirmed())).toEqual({ status: "SAVED" });
    expect(JSON.stringify(log.mock.calls)).not.toContain("PRIVATE");
  });
});
