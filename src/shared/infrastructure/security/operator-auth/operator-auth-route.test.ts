import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { encode } from "next-auth/jwt";
import { generateKeyPairSync, createSign } from "node:crypto";
import { GET, POST } from "@/app/api/operator-auth/[...nextauth]/route";
const origin = "https://operators.example";
const secret = "synthetic-auth-secret-".repeat(3);
const cookieName = "__Host-bloombox.operator-session";
const cookieHeader = (response: Response) => response.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; ");
const request = (action: string, init?: ConstructorParameters<typeof NextRequest>[1]) => new NextRequest(`${origin}/api/operator-auth/${action}`, init);
const discovery = { issuer: "https://accounts.google.com", authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
  userinfo_endpoint: "https://openidconnect.googleapis.com/v1/userinfo", token_endpoint: "https://oauth2.googleapis.com/token", jwks_uri: "https://www.googleapis.com/oauth2/v3/certs",
  response_types_supported: ["code"], subject_types_supported: ["public"], id_token_signing_alg_values_supported: ["RS256"],
  token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"], code_challenge_methods_supported: ["S256"] };
const key = generateKeyPairSync("rsa", { modulusLength: 2048 });
function signedToken(claims: Record<string, unknown>) {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const message = `${part({ alg: "RS256", kid: "synthetic-key" })}.${part(claims)}`;
  return `${message}.${createSign("RSA-SHA256").update(message).sign(key.privateKey).toString("base64url")}`;
}
function browserCookies(...responses: Response[]) {
  const values = new Map<string, string>();
  for (const response of responses) for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(";")[0]; const index = pair.indexOf("=");
    values.set(pair.slice(0, index), pair.slice(index + 1));
  }
  return [...values].map(([name, value]) => `${name}=${value}`).join("; ");
}
beforeEach(() => {
  for (const [name, value] of Object.entries({ AUTH_OPERATOR_ENABLED: "true", AUTH_URL: origin, AUTH_SECRET: secret,
    AUTH_GOOGLE_ID: "synthetic.apps.googleusercontent.com", AUTH_GOOGLE_SECRET: "synthetic-google-secret",
    AUTH_OPERATOR_EMAILS: "operator@example.com", AUTH_OPERATOR_BINDINGS: "[]" })) vi.stubEnv(name, value);
  vi.spyOn(console, "error").mockImplementation(() => undefined); vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe("operator Auth.js boundary", () => {
  it("fails closed without configuration and blocks non-canonical origins and unwanted endpoints", async () => {
    vi.stubEnv("AUTH_OPERATOR_ENABLED", "false");
    expect((await GET(request("session"))).status).toBe(503);
    vi.stubEnv("AUTH_OPERATOR_ENABLED", "true");
    expect((await GET(new NextRequest("https://attacker.example/api/operator-auth/session"))).status).toBe(403);
    expect((await POST(request("signout", { method: "POST" }))).status).toBe(403);
    expect((await POST(request("session", { method: "POST", headers: { origin } }))).status).toBe(404);
    const response = await GET(request("session"));
    expect(await response.json()).toBeNull(); expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("uses Auth.js encryption/cookie validation and strips profile data from a valid private session", async () => {
    const loginExpiresAt = Date.now() + 60_000;
    const token = await encode({ secret, salt: cookieName, maxAge: 900,
      token: { googleSubject: "12345", operatorEmail: "operator@example.com", loginExpiresAt, name: "PRIVATE NAME", access_token: "PRIVATE TOKEN" } });
    const response = await GET(request("session", { headers: { cookie: `${cookieName}=${token}` } }));
    expect(await response.json()).toEqual({ user: { id: "12345" }, expires: new Date(loginExpiresAt).toISOString() });
    expect(response.headers.getSetCookie().join(";")).toMatch(/HttpOnly/); expect(response.headers.getSetCookie().join(";")).toMatch(/Secure/);
    expect(response.headers.getSetCookie().join(";")).not.toMatch(/Domain=/);
    expect(await (await GET(request("session", { headers: { cookie: `${cookieName}=tampered` } }))).json()).toBeNull();
    vi.stubEnv("AUTH_OPERATOR_EMAILS", "other@example.com");
    expect(await (await GET(request("session", { headers: { cookie: `${cookieName}=${token}` } }))).json()).toBeNull();
  });
  it("rejects expired absolute sessions even if the encrypted cookie is otherwise valid", async () => {
    const token = await encode({ secret, salt: cookieName, maxAge: 900,
      token: { googleSubject: "12345", operatorEmail: "operator@example.com", loginExpiresAt: Date.now() - 1 } });
    expect(await (await GET(request("session", { headers: { cookie: `${cookieName}=${token}` } }))).json()).toBeNull();
  });
  it("requires CSRF, creates state/PKCE/nonce, and keeps the callback on the configured origin", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(discovery)); vi.stubGlobal("fetch", fetcher);
    const rejected = await POST(request("signin/google", { method: "POST", headers: { origin, "content-type": "application/x-www-form-urlencoded" }, body: "csrfToken=forged" }));
    expect(rejected.headers.get("location") ?? "").not.toContain("accounts.google.com");
    const csrf = await GET(request("csrf")); const { csrfToken } = await csrf.json();
    const response = await POST(request("signin/google", { method: "POST", headers: { origin, "content-type": "application/x-www-form-urlencoded",
      cookie: cookieHeader(csrf), "x-forwarded-host": "attacker.example", "x-forwarded-proto": "http" },
      body: new URLSearchParams({ csrfToken, callbackUrl: "https://attacker.example" }).toString() }));
    const redirect = new URL(response.headers.get("location") ?? "https://missing.example");
    expect(redirect.origin).toBe("https://accounts.google.com");
    expect(redirect.searchParams.get("redirect_uri")).toBe(`${origin}/api/operator-auth/callback/google`);
    for (const name of ["state", "nonce", "code_challenge"]) expect(redirect.searchParams.get(name)).toBeTruthy();
    expect(redirect.searchParams.get("code_challenge_method")).toBe("S256");
    expect(cookieHeader(response)).toContain("bloombox.operator-state");
    const callback = await GET(request("callback/google?code=untrusted&state=wrong", { headers: { cookie: cookieHeader(response) } }));
    expect(callback.headers.get("location")).toContain("/operations?error=");
    expect(cookieHeader(callback)).not.toContain(`${cookieName}=`);
    expect(fetcher.mock.calls.every(([url]) => String(url).includes(".well-known"))).toBe(true);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toMatch(/untrusted|synthetic-google-secret|operator@example/);
  });
  it.each(["valid", "nonce", "audience", "expired", "signature", "email"] as const)("validates the complete signed OIDC callback: %s", async (variant) => {
    let nonce = "";
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes(".well-known")) return Response.json(discovery);
      if (url === discovery.jwks_uri) return Response.json({ keys: [{ ...key.publicKey.export({ format: "jwk" }), kid: "synthetic-key", alg: "RS256", use: "sig" }] });
      if (url !== discovery.token_endpoint) throw new Error("Unexpected test provider request");
      const issued = Math.floor(Date.now() / 1000);
      const token = signedToken({ iss: discovery.issuer, sub: "12345", aud: variant === "audience" ? "another-client" : "synthetic.apps.googleusercontent.com",
        iat: issued - 10, exp: variant === "expired" ? issued - 3600 : issued + 3600, nonce: variant === "nonce" ? "forged-nonce" : nonce,
        email: variant === "email" ? "other@example.com" : "operator@example.com", email_verified: true, name: "PRIVATE NAME" });
      return Response.json({ access_token: "synthetic-access-token", token_type: "Bearer", expires_in: 3600,
        id_token: variant === "signature" ? token.slice(0, token.lastIndexOf(".") + 1) + "AAAA" : token });
    });
    vi.stubGlobal("fetch", fetcher);
    const csrf = await GET(request("csrf")); const { csrfToken } = await csrf.json();
    const start = await POST(request("signin/google", { method: "POST", headers: { origin, cookie: browserCookies(csrf), "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ csrfToken }).toString() }));
    const authorization = new URL(start.headers.get("location") ?? "https://missing.example");
    nonce = authorization.searchParams.get("nonce") ?? "";
    const state = authorization.searchParams.get("state") ?? "";
    const callback = await GET(request(`callback/google?${new URLSearchParams({ code: "synthetic-code", state })}`, { headers: { cookie: browserCookies(csrf, start) } }));
    if (variant !== "valid") {
      expect(callback.headers.get("location")).toContain("/operations?error=");
      expect(cookieHeader(callback)).not.toContain(`${cookieName}=`);
      return;
    }
    expect(callback.headers.get("location")).toBe(`${origin}/operations`);
    const cookie = browserCookies(csrf, start, callback);
    const session = await GET(request("session", { headers: { cookie } }));
    const data = await session.json();
    expect(data.user).toEqual({ id: "12345" });
    expect(JSON.stringify(data)).not.toMatch(/PRIVATE|access_token|operator@example/);
    expect(Date.parse(data.expires) - Date.now()).toBeLessThanOrEqual(900_000);
    const logout = await POST(request("signout", { method: "POST", headers: { origin, cookie, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ csrfToken }).toString() }));
    expect(logout.headers.get("location")).toBe(`${origin}/operations`);
    expect(await (await GET(request("session", { headers: { cookie: browserCookies(csrf, start, callback, logout) } }))).json()).toBeNull();
  });
  it("bounds posted bodies before handing them to the authentication library", async () => {
    expect((await POST(request("signout", { method: "POST", headers: { origin, "content-type": "application/json" }, body: "{}" }))).status).toBe(415);
    expect((await POST(request("signout", { method: "POST", headers: { origin, "content-type": "application/x-www-form-urlencoded" }, body: "x=" + "a".repeat(8192) }))).status).toBe(413);
  });
});
