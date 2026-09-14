import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthError } from "next-auth";
import { startOperatorLogin, endOperatorLogin } from "@/app/operations/actions";
const mocks = vi.hoisted(() => ({ service: vi.fn(), headers: vi.fn(), signIn: vi.fn(), signOut: vi.fn() }));
vi.mock("./operator-auth", () => ({ getOperatorAuth: mocks.service }));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
const origin = "https://operators.example";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.service.mockReturnValue({ config: { origin }, auth: { signIn: mocks.signIn, signOut: mocks.signOut } });
});
describe("operator login server actions", () => {
  it("rejects missing or foreign origins before creating or deleting a session", async () => {
    for (const value of [null, "https://attacker.example"]) {
      mocks.headers.mockResolvedValue(new Headers(value ? { origin: value } : {}));
      await expect(startOperatorLogin()).rejects.toThrow("redirect:/operations/login?error=unavailable");
      await expect(endOperatorLogin()).rejects.toThrow("redirect:/operations/login?error=unavailable");
    }
    expect(mocks.signIn).not.toHaveBeenCalled(); expect(mocks.signOut).not.toHaveBeenCalled();
  });
  it("validates posted return destinations before calling the provider", async () => {
    mocks.headers.mockResolvedValue(new Headers({ origin }));
    for (const [destination, expected] of [
      ["/operations/catalog", "/operations/catalog"],
      ["https://attacker.example", "/operations"],
      ["/account", "/operations"],
    ]) {
      const form = new FormData(); form.set("next", destination);
      await startOperatorLogin(form);
      expect(mocks.signIn).toHaveBeenLastCalledWith("google", { redirectTo: expected });
    }
  });
  it("uses fixed provider and destination and maps provider failures without exposing diagnostics", async () => {
    mocks.headers.mockResolvedValue(new Headers({ origin }));
    await startOperatorLogin(); await endOperatorLogin();
    expect(mocks.signIn).toHaveBeenCalledWith("google", { redirectTo: "/operations" });
    expect(mocks.signOut).toHaveBeenCalledWith({ redirectTo: "/operations/login" });
    mocks.signIn.mockRejectedValue(new AuthError("PRIVATE PROVIDER DETAILS"));
    await expect(startOperatorLogin()).rejects.toThrow("redirect:/operations/login?error=signin");
    const control = new Error("framework redirect control"); mocks.signIn.mockRejectedValue(control);
    await expect(startOperatorLogin()).rejects.toBe(control);
  });
});
