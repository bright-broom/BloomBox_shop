import { describe, expect, it } from "vitest";
import { loadOperatorAuthConfig, InvalidOperatorAuthConfigurationError } from "./operator-auth-config";
const valid = { AUTH_OPERATOR_ENABLED: "true", AUTH_URL: "https://operators.example", AUTH_SECRET: "s".repeat(48),
  AUTH_GOOGLE_ID: "synthetic.apps.googleusercontent.com", AUTH_GOOGLE_SECRET: "synthetic-google-secret",
  AUTH_OPERATOR_EMAILS: "operator@example.com", AUTH_OPERATOR_BINDINGS: '[{"subject":"12345","operatorId":"00000000-0000-4000-8000-000000000001"}]' };
describe("operator authentication configuration", () => {
  it("defaults to disabled without needing or exposing credentials", () => {
    expect(loadOperatorAuthConfig({})).toBeNull(); expect(loadOperatorAuthConfig({ ...valid, AUTH_OPERATOR_ENABLED: "false" })).toBeNull();
  });
  it("validates explicit account binding and permits HTTP only on local loopback", () => {
    expect(loadOperatorAuthConfig(valid)).toMatchObject({ origin: "https://operators.example", testMode: true, bindings: [{ subject: "12345" }] });
    expect(loadOperatorAuthConfig({ ...valid, AUTH_URL: "http://localhost:3000" })).not.toBeNull();
    expect(loadOperatorAuthConfig({ ...valid, AUTH_OPERATOR_BINDINGS: "[]" })?.bindings).toEqual([]);
  });
  it.each([0, 1, Number.MAX_SAFE_INTEGER])("accepts a server-owned session version: %s", (sessionVersion) => {
    const bindings = [{ subject: "12345", operatorId: "00000000-0000-4000-8000-000000000001", sessionVersion }];
    expect(loadOperatorAuthConfig({ ...valid, AUTH_OPERATOR_BINDINGS: JSON.stringify(bindings) })?.bindings).toEqual(bindings);
  });
  it.each([-1, 1.5, "1", null, true, Number.MAX_SAFE_INTEGER + 1])("rejects invalid session versions without exposing configuration: %s", (sessionVersion) => {
    const bindings = [{ subject: "12345", operatorId: "00000000-0000-4000-8000-000000000001", sessionVersion }];
    expect(() => loadOperatorAuthConfig({ ...valid, AUTH_OPERATOR_BINDINGS: JSON.stringify(bindings) })).toThrow(new InvalidOperatorAuthConfigurationError());
  });
  it.each([
    { AUTH_OPERATOR_ENABLED: "yes" }, { AUTH_SECRET: "short" }, { AUTH_GOOGLE_ID: "wrong" }, { AUTH_GOOGLE_SECRET: "" },
    { AUTH_OPERATOR_EMAILS: "" }, { AUTH_URL: "http://operators.example" }, { AUTH_URL: "https://user:password@operators.example" },
    { AUTH_URL: "https://operators.example/redirect" }, { AUTH_URL: "https://operators.example?next=evil" },
    { AUTH_REDIRECT_PROXY_URL: "https://wrong.example" }, { NEXTAUTH_URL: "https://wrong.example" },
    { AUTH_OPERATOR_BINDINGS: "broken secret text" }, { AUTH_OPERATOR_BINDINGS: '[{"subject":"12345","operatorId":"wrong"}]' },
    { AUTH_OPERATOR_BINDINGS: '[{"subject":"12345","operatorId":"00000000-0000-4000-8000-000000000001"},{"subject":"12345","operatorId":"00000000-0000-4000-8000-000000000002"}]' },
  ])("fails closed with sanitized configuration errors: %j", (override) => {
    expect(() => loadOperatorAuthConfig({ ...valid, ...override })).toThrow(new InvalidOperatorAuthConfigurationError());
  });
});
