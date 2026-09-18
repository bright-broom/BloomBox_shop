import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccountPortalError } from "@/modules/customer/public";

const mocks = vi.hoisted(() => ({ record: vi.fn(), revalidate: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/shared/infrastructure/security/customer-auth/service", () => ({ getCustomerAuth: () => null }));
vi.mock("@/shared/infrastructure/customer-portal", () => ({ recordMembershipAgreement: mocks.record }));

import { agreeToMembership } from "./actions";

function form(values: Record<string, string>) {
  const result = new FormData();
  for (const [key, value] of Object.entries(values)) result.set(key, value);
  return result;
}

beforeEach(() => vi.resetAllMocks());

describe("agreeToMembership", () => {
  it("completes registration on My Page, or returns to the allowed page that asked for it", async () => {
    await expect(agreeToMembership(form({ agree: "on" }))).rejects.toThrow("redirect:/account?welcome=1");
    expect(mocks.revalidate).toHaveBeenCalledWith("/account", "layout");
    await expect(agreeToMembership(form({ agree: "on", next: "/account/profile" }))).rejects.toThrow("redirect:/account/profile");
    await expect(agreeToMembership(form({ agree: "on", next: "//evil.example/account" }))).rejects.toThrow("redirect:/account?welcome=1");
  });

  it("returns to the agreement step with a safe reason and keeps the destination", async () => {
    mocks.record.mockRejectedValueOnce(new AccountPortalError("invalid"));
    await expect(agreeToMembership(form({ next: "/account/profile" }))).rejects.toThrow("redirect:/account/welcome?error=invalid&next=%2Faccount%2Fprofile");
    mocks.record.mockRejectedValueOnce(new AccountPortalError("conflict"));
    await expect(agreeToMembership(form({ agree: "on" }))).rejects.toThrow("redirect:/account/welcome?error=conflict");
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.record.mockRejectedValueOnce(new Error("private database detail"));
    await expect(agreeToMembership(form({ agree: "on" }))).rejects.toThrow("redirect:/account/welcome?error=unavailable");
    expect(log).toHaveBeenCalledWith("customer_membership_agreement_write_failed");
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it("sends an expired session to login and back to the agreement step", async () => {
    mocks.record.mockRejectedValueOnce(new AccountPortalError("expired"));
    await expect(agreeToMembership(form({ agree: "on" }))).rejects.toThrow("redirect:/account/login?next=%2Faccount%2Fwelcome");
  });
});
