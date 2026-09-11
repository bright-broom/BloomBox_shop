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
    expect(token).toEqual({ googleSubject: "12345", operatorEmail: "operator@example.com", operatorId: config.bindings[0].operatorId,
      sessionVersion: 0, loginExpiresAt: now + OPERATOR_SESSION_SECONDS * 1000 });
    if (!token) throw new Error("Expected token");
    expect(await callbacks.jwt!({ token, user: {}, trigger: "update", session: { googleSubject: "attacker", operatorId: "attacker", sessionVersion: 999, loginExpiresAt: now + 99999999 } })).toEqual(token);
    const expired = createOperatorAuthOptions(config, () => now + OPERATOR_SESSION_SECONDS * 1000).callbacks!;
    expect(await expired.jwt!({ token, user: {} })).toBeNull();
    const revoked = createOperatorAuthOptions({ ...config, allowedEmails: [] }, () => now).callbacks!;
    expect(await revoked.jwt!({ token, user: {} })).toBeNull();
    expect(await callbacks.jwt!({ token: { ...token, loginExpiresAt: now + 99999999 }, user: {} })).toBeNull();
  });
  it("revokes only the selected subject's sessions and admits a new verified login at the current version", async () => {
    const token = await callbacks.jwt!({ token: {}, user: {}, account, profile, trigger: "signIn" });
    if (!token) throw new Error("Expected token");
    const otherSubject = "67890", otherId = "00000000-0000-4000-8000-000000000002";
    const revisedConfig = { ...config, bindings: [{ ...config.bindings[0], sessionVersion: 1 }, { subject: otherSubject, operatorId: otherId }] };
    const revised = createOperatorAuthOptions(revisedConfig, () => now).callbacks!;
    for (let attempt = 0; attempt < 3; attempt++) {
      expect(await revised.jwt!({ token, user: {} })).toBeNull();
      expect(await revised.jwt!({ token, user: {}, trigger: "update", session: { sessionVersion: 1, operatorId: config.bindings[0].operatorId } })).toBeNull();
    }
    const otherCallbacks = createOperatorAuthOptions({ ...config, bindings: revisedConfig.bindings.map((binding) => ({ ...binding, sessionVersion: 0 })) }, () => now).callbacks!;
    const otherToken = await otherCallbacks.jwt!({ token: {}, user: {}, account: { ...account, providerAccountId: otherSubject }, profile: { ...profile, sub: otherSubject }, trigger: "signIn" });
    if (!otherToken) throw new Error("Expected other token");
    expect(await revised.jwt!({ token: otherToken, user: {} })).toEqual(otherToken);
    const fresh = await revised.jwt!({ token, user: {}, account, profile, trigger: "signIn" });
    expect(fresh).toMatchObject({ sessionVersion: 1, operatorId: config.bindings[0].operatorId });
    if (!fresh) throw new Error("Expected fresh token");
    expect(await revised.jwt!({ token: fresh, user: {} })).toEqual(fresh);
  });
  it("requires a new login after removing, replacing or first adding a binding", async () => {
    const token = await callbacks.jwt!({ token: {}, user: {}, account, profile, trigger: "signIn" });
    if (!token) throw new Error("Expected token");
    const unbound = createOperatorAuthOptions({ ...config, bindings: [] }, () => now).callbacks!;
    expect(await unbound.jwt!({ token, user: {} })).toBeNull();
    const replaced = createOperatorAuthOptions({ ...config, bindings: [{ ...config.bindings[0], operatorId: "00000000-0000-4000-8000-000000000002" }] }, () => now).callbacks!;
    expect(await replaced.jwt!({ token, user: {} })).toBeNull();
    const registration = await unbound.jwt!({ token: {}, user: {}, account, profile, trigger: "signIn" });
    if (!registration) throw new Error("Expected registration token");
    expect(registration).toMatchObject({ operatorId: null, sessionVersion: 0 });
    expect(await unbound.jwt!({ token: registration, user: {} })).toEqual(registration);
    expect(await callbacks.jwt!({ token: registration, user: {} })).toBeNull();
  });
  it.each([
    {}, { operatorId: config.bindings[0].operatorId }, { sessionVersion: 0 },
    { operatorId: "invalid", sessionVersion: 0 }, { operatorId: config.bindings[0].operatorId, sessionVersion: "0" },
    { operatorId: config.bindings[0].operatorId, sessionVersion: -1 }, { operatorId: config.bindings[0].operatorId, sessionVersion: 0.5 },
    { operatorId: config.bindings[0].operatorId, sessionVersion: Number.MAX_SAFE_INTEGER + 1 },
  ])("rejects legacy or malformed session claims without upgrading them: %j", async (claims) => {
    expect(await callbacks.jwt!({ token: { googleSubject: "12345", operatorEmail: "operator@example.com", loginExpiresAt: now + 60_000, ...claims }, user: {} })).toBeNull();
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
