import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthError } from "next-auth";
import { startCustomerLogin, endCustomerLogin } from "@/app/account/actions";
const mocks = vi.hoisted(() => ({ service: vi.fn(), headers: vi.fn(), signIn: vi.fn(), signOut: vi.fn() }));
vi.mock("./service", () => ({ getCustomerAuth: mocks.service }));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
const origin = "https://customers.example";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.service.mockReturnValue({ config: { origin }, auth: { signIn: mocks.signIn, signOut: mocks.signOut } });
});
describe("customer login server actions", () => {
  it("rejects missing or foreign origins before creating or deleting a session", async () => {
    for (const value of [null, "https://attacker.example"]) {
      mocks.headers.mockResolvedValue(new Headers(value ? { origin: value } : {}));
      await expect(startCustomerLogin()).rejects.toThrow("redirect:/account?error=unavailable");
      await expect(endCustomerLogin()).rejects.toThrow("redirect:/account?error=unavailable");
    }
    expect(mocks.signIn).not.toHaveBeenCalled(); expect(mocks.signOut).not.toHaveBeenCalled();
  });
  it("uses fixed provider and destination and maps provider failures without exposing diagnostics", async () => {
    mocks.headers.mockResolvedValue(new Headers({ origin }));
    await startCustomerLogin(); await endCustomerLogin();
    expect(mocks.signIn).toHaveBeenCalledWith("google", { redirectTo: "/account" });
    expect(mocks.signOut).toHaveBeenCalledWith({ redirectTo: "/account" });
    mocks.signIn.mockRejectedValue(new AuthError("PRIVATE PROVIDER DETAILS"));
    await expect(startCustomerLogin()).rejects.toThrow("redirect:/account?error=signin");
    const control = new Error("framework redirect control"); mocks.signIn.mockRejectedValue(control);
    await expect(startCustomerLogin()).rejects.toBe(control);
  });
});
