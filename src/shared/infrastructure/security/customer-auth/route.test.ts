import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { encode } from "next-auth/jwt";
import { generateKeyPairSync, createSign, createHash } from "node:crypto";
import { GET, POST } from "@/app/api/customer-auth/[...nextauth]/route";
import { readCustomerCredential } from "./service";
import { loadCustomerAccountConfig } from "../../config/customer-account-config";
import { CUSTOMER_SESSION_COOKIE as cookieName } from "./options";
const origin = "https://account.example.test", secret = "synthetic-customer-secret-".repeat(3);
const environment = { CUSTOMER_ACCOUNT_ENABLED: "true", CUSTOMER_ACCOUNT_ORIGIN: origin,
  CUSTOMER_ACCOUNT_SECRET: secret, CUSTOMER_ACCOUNT_CLIENT_ID: "synthetic-client", CUSTOMER_ACCOUNT_CLIENT_SECRET: "synthetic-client-secret",
  CUSTOMER_ACCOUNT_SHOP_ID: "123456", SHOPIFY_STORE_DOMAIN: "synthetic-store.myshopify.com", AUTH_URL: origin };
const issuer = "https://shopify.com/authentication/123456";
const discovery = { issuer, authorization_endpoint: `${issuer}/oauth/authorize`, token_endpoint: `${issuer}/oauth/token`,
  jwks_uri: `${issuer}/.well-known/jwks.json`, response_types_supported: ["code"], subject_types_supported: ["public"],
  id_token_signing_alg_values_supported: ["RS256"], token_endpoint_auth_methods_supported: ["client_secret_basic"], code_challenge_methods_supported: ["S256"] };
const config = loadCustomerAccountConfig(environment)!;
const request = (action: string, init?: ConstructorParameters<typeof NextRequest>[1]) => new NextRequest(`${origin}/api/customer-auth/${action}`, init);
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
const credential = () => ({ subject: "customer-a", shopId: "123456", clientId: "synthetic-client",
  accessToken: "private-token", expiresAt: Date.now() + 60_000 });
beforeEach(() => {
  for (const [name, value] of Object.entries(environment)) vi.stubEnv(name, value);
  vi.spyOn(console, "error").mockImplementation(() => undefined); vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe("customer authentication boundary", () => {
  it("fails closed without setup, checks origin, and rejects unsupported session mutation and large bodies", async () => {
    vi.stubEnv("CUSTOMER_ACCOUNT_ENABLED", "false"); expect((await GET(request("session"))).status).toBe(503);
    vi.stubEnv("CUSTOMER_ACCOUNT_ENABLED", "true");
    expect((await GET(new NextRequest("https://attacker.test/api/customer-auth/session"))).status).toBe(403);
    expect((await POST(request("signout", { method: "POST" }))).status).toBe(403);
    expect((await POST(request("session", { method: "POST", headers: { origin } }))).status).toBe(404);
    expect((await POST(request("signout", { method: "POST", headers: { origin, "content-type": "application/json" }, body: "{}" }))).status).toBe(415);
    expect((await POST(request("signout", { method: "POST", headers: { origin, "content-type": "application/x-www-form-urlencoded" }, body: "x=" + "a".repeat(8192) }))).status).toBe(413);
  });
  it("reads only the encrypted customer cookie and redacts tokens from session JSON", async () => {
    const token = await encode({ secret, salt: cookieName, maxAge: 900, token: credential() });
    expect(await readCustomerCredential(`${cookieName}=${token}`, config)).toMatchObject({ accessToken: "private-token" });
    const session = await GET(request("session", { headers: { cookie: `${cookieName}=${token}` } }));
    expect(await session.json()).toEqual({ user: { id: "customer-a" }, expires: expect.any(String) });
    expect(session.headers.get("cache-control")).toContain("no-store");
    expect(session.headers.getSetCookie().join(";")).toMatch(/HttpOnly/);
    expect(session.headers.getSetCookie().join(";")).toMatch(/Secure/);
    expect(session.headers.getSetCookie().join(";")).not.toMatch(/Domain=/);
    expect(await readCustomerCredential(`${cookieName}=tampered`, config)).toBeNull();
    expect(await readCustomerCredential(`__Host-bloombox.operator-session=${token}`, config)).toBeNull();
    expect(await readCustomerCredential(`${cookieName}=${token}`, { ...config, secret: "different-secret".repeat(4) })).toBeNull();
  });
  it.each([{ shopId: "999999" }, { clientId: "another-client" }, { expiresAt: 1 }, { expiresAt: Number.MAX_SAFE_INTEGER }])(
    "rejects wrong-tenant and expired or extended sessions: %j", async (override) => {
      const token = await encode({ secret, salt: cookieName, maxAge: 900, token: { ...credential(), ...override } });
      expect(await readCustomerCredential(`${cookieName}=${token}`, config)).toBeNull();
      expect(await (await GET(request("session", { headers: { cookie: `${cookieName}=${token}` } }))).json()).toBeNull();
    });
  it("requires CSRF, state, PKCE and nonce, and rejects caller-selected callbacks", async () => {
    const transport = vi.fn<typeof fetch>(async () => Response.json(discovery)); vi.stubGlobal("fetch", transport);
    const rejected = await POST(request("signin/shopify-customer", { method: "POST", headers: { origin, "content-type": "application/x-www-form-urlencoded" }, body: "csrfToken=forged" }));
    expect(rejected.headers.get("location") ?? "").not.toContain("shopify.com");
    const csrf = await GET(request("csrf")); const { csrfToken } = await csrf.json();
    const start = await POST(request("signin/shopify-customer", { method: "POST", headers: { origin,
      cookie: browserCookies(csrf), "content-type": "application/x-www-form-urlencoded", "x-forwarded-host": "attacker.test" },
      body: new URLSearchParams({ csrfToken, callbackUrl: "https://attacker.test" }).toString() }));
    const location = new URL(start.headers.get("location")!);
    expect(location.origin + location.pathname).toBe(discovery.authorization_endpoint);
    expect(location.searchParams.get("redirect_uri")).toBe(`${origin}/api/customer-auth/callback/shopify-customer`);
    for (const field of ["nonce", "state", "code_challenge"]) expect(location.searchParams.get(field)).toBeTruthy();
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    const callback = await GET(request("callback/shopify-customer?code=forged&state=wrong", { headers: { cookie: browserCookies(csrf, start) } }));
    expect(callback.headers.get("location")).toContain("/account?error=");
    expect(browserCookies(callback)).not.toContain(cookieName);
    expect(transport.mock.calls.every(([url]) => String(url).includes(".well-known"))).toBe(true);
  });
  it.each(["valid", "nonce", "audience", "issuer", "expired", "signature"])("checks a signed end-to-end OAuth callback: %s", async (variant) => {
    let nonce = "", challenge = "";
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url === discovery.jwks_uri) return Response.json({ keys: [{ ...key.publicKey.export({ format: "jwk" }), kid: "synthetic-key", alg: "RS256", use: "sig" }] });
      if (url.includes("openid-configuration")) return Response.json(discovery);
      if (url !== discovery.token_endpoint) throw new Error("Unexpected test provider request");
      const verifier = new URLSearchParams(String(init?.body)).get("code_verifier");
      expect(verifier).toBeTruthy();
      expect(createHash("sha256").update(verifier!).digest("base64url")).toBe(challenge);
      expect(new Headers(init?.headers).get("authorization")).toBe("Basic " + Buffer.from("synthetic-client:synthetic-client-secret").toString("base64"));
      const issued = Math.floor(Date.now() / 1000);
      const token = signedToken({ iss: variant === "issuer" ? issuer.replace("123456", "999999") : issuer,
        sub: "customer-a", aud: variant === "audience" ? "other-client" : "synthetic-client", iat: issued - 10,
        exp: variant === "expired" ? issued - 3600 : issued + 3600, nonce: variant === "nonce" ? "wrong" : nonce });
      return Response.json({ access_token: "private-token", refresh_token: "do-not-retain", token_type: "Bearer", expires_in: 3600,
        id_token: variant === "signature" ? token.slice(0, token.lastIndexOf(".") + 1) + "AAAA" : token });
    }));
    const csrf = await GET(request("csrf")); const { csrfToken } = await csrf.json();
    const start = await POST(request("signin/shopify-customer", { method: "POST", headers: { origin, cookie: browserCookies(csrf), "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ csrfToken }).toString() }));
    const location = new URL(start.headers.get("location")!); nonce = location.searchParams.get("nonce") ?? ""; challenge = location.searchParams.get("code_challenge") ?? "";
    const callback = await GET(request(`callback/shopify-customer?${new URLSearchParams({ code: "synthetic-code", state: location.searchParams.get("state") ?? "" })}`,
      { headers: { cookie: browserCookies(csrf, start) } }));
    if (variant !== "valid") {
      expect(callback.headers.get("location")).toContain("/account?error=");
      expect(browserCookies(callback)).not.toContain(cookieName); return;
    }
    expect(callback.headers.get("location")).toBe(`${origin}/account`);
    const cookies = browserCookies(csrf, start, callback);
    const privateCredential = await readCustomerCredential(cookies, config);
    expect(privateCredential).toMatchObject({ subject: "customer-a", accessToken: "private-token" });
    expect(JSON.stringify(privateCredential)).not.toMatch(/do-not-retain|refresh_token|id_token/);
    const session = await GET(request("session", { headers: { cookie: cookies } }));
    expect(JSON.stringify(await session.json())).not.toMatch(/private-token|accessToken|refresh|do-not-retain/);
    const logout = await POST(request("signout", { method: "POST", headers: { origin, cookie: cookies, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ csrfToken }).toString() }));
    expect(logout.headers.get("location")).toBe(`${origin}/account`);
    expect(await readCustomerCredential(browserCookies(csrf, start, callback, logout), config)).toBeNull();
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toMatch(/synthetic-code|private-token|customer-a/);
  });
});
