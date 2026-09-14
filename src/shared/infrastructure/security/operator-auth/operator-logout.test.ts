import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encode } from "next-auth/jwt";
import { endOperatorLogin } from "@/app/operations/actions";
import { getOperatorAuth } from "./operator-auth";

const mocks = vi.hoisted(() => ({ headers: vi.fn(), cookies: vi.fn(), set: vi.fn(), redirect: vi.fn() }));
vi.mock("next/headers", () => ({ headers: mocks.headers, cookies: mocks.cookies }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
const secret = "synthetic-logout-secret-".repeat(3);
const operatorId = "00000000-0000-4000-8000-000000000001";
const redirectSignal = new Error("framework redirect");

beforeEach(() => {
  vi.resetAllMocks();
  for (const [name, value] of Object.entries({ AUTH_OPERATOR_ENABLED: "true", AUTH_SECRET: secret,
    AUTH_GOOGLE_ID: "synthetic.apps.googleusercontent.com", AUTH_GOOGLE_SECRET: "synthetic-google-secret",
    AUTH_OPERATOR_EMAILS: "operator@example.com", AUTH_OPERATOR_BINDINGS: JSON.stringify([{ subject: "12345", operatorId }]) })) vi.stubEnv(name, value);
  mocks.redirect.mockImplementation(() => { throw redirectSignal; });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

async function browserSession(origin: string, chunked = false) {
  vi.stubEnv("AUTH_URL", origin);
  const secure = origin.startsWith("https:");
  const cookieName = `${secure ? "__Host-" : ""}bloombox.operator-session`;
  const expiresAt = new Date(Date.now() + 600_000);
  const token = await encode({ secret, salt: cookieName, maxAge: 900,
    token: { googleSubject: "12345", operatorEmail: "operator@example.com", operatorId, sessionVersion: 0, loginExpiresAt: expiresAt.getTime() } });
  const jar = new Map([["__Host-bloombox.google-customer-session", "synthetic-customer-cookie"]]);
  if (chunked) {
    const middle = Math.floor(token.length / 2);
    jar.set(`${cookieName}.0`, token.slice(0, middle)); jar.set(`${cookieName}.1`, token.slice(middle));
  } else jar.set(cookieName, token);
  mocks.headers.mockImplementation(async () => new Headers({ origin, host: new URL(origin).host,
    "x-forwarded-proto": secure ? "https" : "http", cookie: [...jar].map(([name, value]) => `${name}=${value}`).join("; ") }));
  // Only Next's request/response boundary is simulated; signOut and JWT handling are real Auth.js.
  // Applying response cookies here models the cookie header on the next request, not browser routing.
  mocks.set.mockImplementation((name: string, value: string, options: { maxAge?: number }) => {
    if (options.maxAge === 0) jar.delete(name); else jar.set(name, value);
  });
  mocks.cookies.mockResolvedValue({ set: mocks.set });
  return { cookieName, jar, expiresAt, secure };
}

describe.each(["http://localhost:3000", "https://operators.example"])("operator logout through real Auth.js: %s", (origin) => {
  it.each([false, true])("deletes the session before redirect, preserves other cookies and allows repeat logout (chunked=%s)", async (chunked) => {
    const { cookieName, jar, expiresAt, secure } = await browserSession(origin, chunked);
    expect(await getOperatorAuth()!.auth.auth()).toEqual({ user: { id: "12345" }, expires: expiresAt.toISOString() });
    await expect(endOperatorLogin()).rejects.toBe(redirectSignal);
    const names = chunked ? [`${cookieName}.0`, `${cookieName}.1`] : [cookieName];
    for (const name of names) expect(mocks.set).toHaveBeenCalledWith(name, "", expect.objectContaining({ maxAge: 0, path: "/", httpOnly: true, sameSite: "lax", secure }));
    expect(mocks.set.mock.invocationCallOrder.at(-1)).toBeLessThan(mocks.redirect.mock.invocationCallOrder[0]);
    expect(mocks.redirect).toHaveBeenCalledWith(`${origin}/operations/login`);
    expect([...jar.keys()].some((name) => name.startsWith(cookieName))).toBe(false);
    expect(jar.get("__Host-bloombox.google-customer-session")).toBe("synthetic-customer-cookie");
    expect(await getOperatorAuth()!.auth.auth()).toBeNull();
    await expect(endOperatorLogin()).rejects.toBe(redirectSignal);
    expect(await getOperatorAuth()!.auth.auth()).toBeNull();
    expect([...jar.keys()].some((name) => name.startsWith(cookieName))).toBe(false);
    expect(jar.get("__Host-bloombox.google-customer-session")).toBe("synthetic-customer-cookie");
  });
  it("clears an unreadable session instead of keeping the invalid cookie", async () => {
    const { cookieName, jar } = await browserSession(origin);
    jar.set(cookieName, "tampered");
    await expect(endOperatorLogin()).rejects.toBe(redirectSignal);
    expect(jar.has(cookieName)).toBe(false);
    expect(await getOperatorAuth()!.auth.auth()).toBeNull();
  });
  it("does not redirect as successful when writing the deletion cookie fails", async () => {
    const { cookieName, jar } = await browserSession(origin);
    const failure = new Error("synthetic response cookie failure");
    mocks.set.mockImplementation((name: string) => { if (name === cookieName) throw failure; });
    await expect(endOperatorLogin()).rejects.toBe(failure);
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(jar.has(cookieName)).toBe(true);
  });
});
