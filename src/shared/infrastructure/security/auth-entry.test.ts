import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ config: vi.fn(), credential: vi.fn(), headers: vi.fn(), operator: vi.fn(), session: vi.fn() }));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
vi.mock("../config/customer-account-config", () => ({ loadCustomerAccountConfig: mocks.config }));
vi.mock("./customer-auth/service", () => ({ readCustomerCredential: mocks.credential }));
vi.mock("./operator-auth/operator-auth", () => ({ getOperatorAuth: mocks.operator }));
import { loadCustomerEntry, loadOperatorEntry, requireOperatorLogin } from "./auth-entry";
beforeEach(() => vi.resetAllMocks());
describe("login entry checks remain isolated from account/order queries", () => {
  it("distinguishes unconfigured, signed-out and active customers and never inspects operator cookies", async () => {
    mocks.config.mockReturnValue(null); expect(await loadCustomerEntry()).toEqual({ status: "disabled" });
    expect(mocks.headers).not.toHaveBeenCalled();
    mocks.config.mockReturnValue({}); mocks.headers.mockResolvedValue(new Headers()); mocks.credential.mockResolvedValue(null);
    expect(await loadCustomerEntry()).toEqual({ status: "signed-out" });
    mocks.credential.mockResolvedValue({ customerId: "verified" }); expect(await loadCustomerEntry()).toEqual({ status: "ready" });
    expect(mocks.operator).not.toHaveBeenCalled();
  });
  it("distinguishes operator authentication from a configured binding and enforces entry before page data", async () => {
    mocks.operator.mockReturnValue(null); expect(await loadOperatorEntry()).toEqual({ status: "disabled" });
    await expect(requireOperatorLogin("/operations/catalog")).rejects.toThrow("redirect:/operations/login?next=%2Foperations%2Fcatalog");
    mocks.operator.mockReturnValue({ config: { bindings: [] }, auth: { auth: mocks.session } });
    mocks.session.mockResolvedValue(null); expect(await loadOperatorEntry()).toEqual({ status: "signed-out" });
    mocks.session.mockResolvedValue({ user: { id: "12345" }, expires: new Date(Date.now() + 600000).toISOString() });
    expect(await loadOperatorEntry()).toEqual({ status: "ready", subject: "12345", bound: false });
    await expect(requireOperatorLogin("/operations/customers")).rejects.toThrow("redirect:");
    mocks.operator.mockReturnValue({ config: { bindings: [{ subject: "12345", operatorId: "12345678-abcd-4000-8000-123456789012" }] }, auth: { auth: mocks.session } });
    await expect(requireOperatorLogin("/operations/catalog")).resolves.toBeUndefined();
    expect(mocks.credential).not.toHaveBeenCalled();
  });
  it("returns recoverable failures with fixed logs and no redirect loops", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.config.mockImplementation(() => { throw new Error("PRIVATE CONFIG"); });
    mocks.operator.mockImplementation(() => { throw new Error("PRIVATE PROVIDER"); });
    expect(await loadCustomerEntry()).toEqual({ status: "unavailable" });
    expect(await loadOperatorEntry()).toEqual({ status: "unavailable" });
    expect(JSON.stringify(log.mock.calls)).not.toContain("PRIVATE"); log.mockRestore();
  });
});
