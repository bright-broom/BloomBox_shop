import { describe, expect, it, vi } from "vitest";
import { createOperatorAuthOptions, OPERATOR_SESSION_SECONDS } from "./auth-config";
import { GoogleFulfillmentOperatorIdentity } from "./google-operator-identity";
const config = { origin: "https://operators.example", secret: "s".repeat(48), clientId: "synthetic.apps.googleusercontent.com", clientSecret: "synthetic-google-secret",
  allowedEmails: ["operator@example.com"], bindings: [{ subject: "12345", operatorId: "00000000-0000-4000-8000-000000000001" }], testMode: true };
const account = { provider: "google", providerAccountId: "12345", type: "oidc" as const };
const profile = { sub: "12345", iss: "https://accounts.google.com", email: "operator@example.com", email_verified: true };
const now = Date.now();
const callbacks = createOperatorAuthOptions(config, () => now).callbacks!;
describe("Google operator authentication policy", () => {
  it("admits only the verified Google profile and matching provider account", async () => {
    expect(await callbacks.signIn!({ user: { id: "ignored" }, account, profile })).toBe(true);
    for (const changed of [{ ...profile, email_verified: false }, { ...profile, iss: "https://attacker.example" }, { ...profile, email: "someone@example.com" }]) {
      expect(await callbacks.signIn!({ user: {}, account, profile: changed })).toBe(false);
    }
    expect(await callbacks.signIn!({ user: {}, account: { ...account, providerAccountId: "wrong" }, profile })).toBe(false);
    expect(await callbacks.signIn!({ user: {}, account: { ...account, provider: "other" }, profile })).toBe(false);
  });
  it("retains only verified identity and an absolute expiry, ignores client updates, and revokes removed accounts", async () => {
    const token = await callbacks.jwt!({ token: {}, user: {}, account, profile, trigger: "signIn" });
    expect(token).toEqual({ googleSubject: "12345", operatorEmail: "operator@example.com", loginExpiresAt: now + OPERATOR_SESSION_SECONDS * 1000 });
    if (!token) throw new Error("Expected token");
    expect(await callbacks.jwt!({ token, user: {}, trigger: "update", session: { googleSubject: "attacker", loginExpiresAt: now + 99999999 } })).toEqual(token);
    const expired = createOperatorAuthOptions(config, () => now + OPERATOR_SESSION_SECONDS * 1000).callbacks!;
    expect(await expired.jwt!({ token, user: {} })).toBeNull();
    const revoked = createOperatorAuthOptions({ ...config, allowedEmails: [] }, () => now).callbacks!;
    expect(await revoked.jwt!({ token, user: {} })).toBeNull();
    expect(await callbacks.jwt!({ token: { ...token, loginExpiresAt: now + 99999999 }, user: {} })).toBeNull();
  });
  it("never accepts caller-chosen return origins or retains raw provider diagnostics", async () => {
    expect(await callbacks.redirect!({ url: "https://attacker.example", baseUrl: "https://attacker.example" })).toBe("https://operators.example/operations");
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    createOperatorAuthOptions(config).logger?.error?.(new Error("PRIVATE-CREDENTIAL"));
    expect(error).toHaveBeenCalledWith("operator_auth_error"); error.mockRestore();
  });
  it("maps a verified subject independently of browser role/email claims and rejects expiry or missing bindings", async () => {
    const session = { user: { id: "12345", email: "forged@example.com", isAdmin: true }, expires: new Date(now + 1000).toISOString() };
    expect(await new GoogleFulfillmentOperatorIdentity(async () => session, config.bindings, () => new Date(now)).current())
      .toEqual({ operatorId: config.bindings[0].operatorId, expiresAt: new Date(now + 1000) });
    expect(await new GoogleFulfillmentOperatorIdentity(async () => session, [], () => new Date(now)).current()).toBeNull();
    expect(await new GoogleFulfillmentOperatorIdentity(async () => session, config.bindings, () => new Date(now + 1000)).current()).toBeNull();
    expect(await new GoogleFulfillmentOperatorIdentity(async () => ({ user: { email: "operator@example.com" } }), config.bindings).current()).toBeNull();
  });
});
