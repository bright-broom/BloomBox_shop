import { describe, expect, it } from "vitest";
import { loginDestination, loginHref, authRedirect } from "./auth-navigation";
const id = "12345678-abcd-4000-8000-123456789012";
describe("separate local login destinations", () => {
  it.each([undefined, ["/account"], "https://evil.example", "//evil.example", "/\\evil.example", "/account/login", "/account?next=https://evil.example", "/account/orders/invalid", "/account/%2e%2e/operations"])("rejects untrusted customer return %j", (url) => {
    expect(loginDestination(url, "customer")).toBe("/account");
  });
  it("keeps only known customer and operator routes, without crossing roles", () => {
    expect(loginDestination(`/account/orders/${id}`, "customer")).toBe(`/account/orders/${id}`);
    expect(loginDestination("/operations/catalog", "customer")).toBe("/account");
    expect(loginDestination("/account", "operator")).toBe("/operations");
    expect(loginDestination(`/operations/customers/${id}`, "operator")).toBe(`/operations/customers/${id}`);
    expect(loginDestination("/operations/unknown", "operator")).toBe("/operations");
    expect(loginHref("operator", "/operations/catalog")).toBe("/operations/login?next=%2Foperations%2Fcatalog");
  });
  it.each(["customer", "operator"] as const)("validates callback origin and logout destination for %s", (area) => {
    const origin = "https://shop.example", home = area === "customer" ? "/account" : "/operations";
    for (const url of ["https://evil.example", "//evil.example", "https://shop.example.evil.example/account", "javascript:alert(1)"])
      expect(authRedirect(url, origin, area)).toBe(origin + home);
    expect(authRedirect(origin + home + "/login", origin, area)).toBe(origin + home + "/login");
    expect(authRedirect(home, origin, area)).toBe(origin + home);
  });
});
