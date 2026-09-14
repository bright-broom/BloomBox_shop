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
      await expect(startCustomerLogin()).rejects.toThrow("redirect:/account/login?error=unavailable");
      await expect(endCustomerLogin()).rejects.toThrow("redirect:/account/login?error=unavailable");
    }
    expect(mocks.signIn).not.toHaveBeenCalled(); expect(mocks.signOut).not.toHaveBeenCalled();
  });
  it("validates posted return destinations before calling the provider", async () => {
    mocks.headers.mockResolvedValue(new Headers({ origin }));
    for (const [destination, expected] of [
      ["/account/orders/12345678-1234-4234-8234-123456789abc", "/account/orders/12345678-1234-4234-8234-123456789abc"],
      ["https://attacker.example", "/account"],
      ["/operations/catalog", "/account"],
    ]) {
      const form = new FormData(); form.set("next", destination);
      await startCustomerLogin(form);
      expect(mocks.signIn).toHaveBeenLastCalledWith("google", { redirectTo: expected });
    }
  });
  it("uses fixed provider and destination and maps provider failures without exposing diagnostics", async () => {
    mocks.headers.mockResolvedValue(new Headers({ origin }));
    await startCustomerLogin(); await endCustomerLogin();
    expect(mocks.signIn).toHaveBeenCalledWith("google", { redirectTo: "/account" });
    expect(mocks.signOut).toHaveBeenCalledWith({ redirectTo: "/account/login" });
    mocks.signIn.mockRejectedValue(new AuthError("PRIVATE PROVIDER DETAILS"));
    await expect(startCustomerLogin()).rejects.toThrow("redirect:/account/login?error=signin");
    const control = new Error("framework redirect control"); mocks.signIn.mockRejectedValue(control);
    await expect(startCustomerLogin()).rejects.toBe(control);
  });
});
