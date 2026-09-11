import { createRemoteJWKSet, customFetch, jwtVerify } from "jose";
import { z } from "zod";

const GOOGLE_AUTH_HOSTS = new Set(["accounts.google.com", "oauth2.googleapis.com", "www.googleapis.com"]);
const RESPONSE_LIMIT = 256 * 1024;
/** Bound provider discovery/token/JWK reads. Never follow redirects carrying OAuth credentials. */
export const googleAuthFetch: typeof fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.protocol !== "https:" || url.username || url.password || !GOOGLE_AUTH_HOSTS.has(url.hostname) || (url.port && url.port !== "443")) {
    throw new Error("Operator provider request rejected");
  }
  const upstreamSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
  const signal = AbortSignal.any([AbortSignal.timeout(5_000), ...(upstreamSignal ? [upstreamSignal] : [])]);
  const response = await fetch(input, { ...init, signal, redirect: "error", cache: "no-store" });
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Operator provider response unavailable");
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > RESPONSE_LIMIT) throw new Error("Operator provider response too large");
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  return new Response(Buffer.concat(chunks), { status: response.status, statusText: response.statusText, headers: response.headers });
};

// Auth.js validates OIDC claims and nonce. Explicitly verify the token signature as well.
const googleKeys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"), {
  [customFetch]: googleAuthFetch, timeoutDuration: 5_000,
});
export function createGoogleTokenFetch(clientId: string): typeof fetch {
  return async (input, init) => {
    const response = await googleAuthFetch(input, init);
    const url = input instanceof Request ? input.url : String(input);
    if (url === "https://oauth2.googleapis.com/token" && response.ok) {
      const token = z.object({ id_token: z.string().min(1) }).parse(await response.clone().json());
      await jwtVerify(token.id_token, googleKeys, {
        issuer: "https://accounts.google.com", audience: clientId, algorithms: ["RS256"],
        requiredClaims: ["sub", "iat", "exp", "nonce", "email", "email_verified"],
      });
    }
    return response;
  };
}
