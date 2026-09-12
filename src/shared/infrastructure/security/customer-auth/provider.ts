import { createRemoteJWKSet, customFetch, jwtVerify } from "jose";
import { z } from "zod";
import type { CustomerAccountConfig } from "../../config/customer-account-config";

export const CUSTOMER_API_VERSION = "2026-07";
export function customerEndpoints(config: CustomerAccountConfig) {
  const issuer = `https://shopify.com/authentication/${config.shopId}`;
  return { issuer, authorization: `${issuer}/oauth/authorize`, token: `${issuer}/oauth/token`,
    jwks: `${issuer}/.well-known/jwks.json`,
    discovery: `https://${config.storeDomain}/.well-known/openid-configuration`,
    apiDiscovery: `https://${config.storeDomain}/.well-known/customer-account-api`,
    graphql: `https://shopify.com/${config.shopId}/account/customer/api/${CUSTOMER_API_VERSION}/graphql` };
}
/** Exact shop-scoped destinations only. A provider redirect never receives a token or secret. */
export function createCustomerFetch(config: CustomerAccountConfig, transport: typeof fetch = fetch): typeof fetch {
  const endpoints = customerEndpoints(config);
  const allowed = new Set([endpoints.discovery, endpoints.apiDiscovery, endpoints.token, endpoints.jwks, endpoints.graphql]);
  return async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!allowed.has(url)) throw new Error("Customer provider destination rejected");
    const upstream = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const signal = AbortSignal.any([AbortSignal.timeout(5_000), ...(upstream ? [upstream] : [])]);
    const response = await transport(input, { ...init, signal, cache: "no-store", redirect: "error" });
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Customer provider response unavailable");
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 256 * 1024) throw new Error("Customer provider response too large");
        chunks.push(value);
      }
    } finally { await reader.cancel(); }
    return new Response(Buffer.concat(chunks), { status: response.status, headers: response.headers });
  };
}
export function createCustomerTokenFetch(config: CustomerAccountConfig, transport: typeof fetch = fetch): typeof fetch {
  const endpoints = customerEndpoints(config);
  const bounded = createCustomerFetch(config, transport);
  const keys = createRemoteJWKSet(new URL(endpoints.jwks), { [customFetch]: bounded, timeoutDuration: 5_000 });
  return async (input, init) => {
    const requested = input instanceof Request ? input.url : String(input);
    // Auth.js derives discovery from issuer; Shopify publishes discovery on the storefront domain.
    const url = requested === `${endpoints.issuer}/.well-known/openid-configuration` ? endpoints.discovery : requested;
    const response = await bounded(url, init);
    if (response.ok && url === endpoints.discovery) {
      z.object({ issuer: z.literal(endpoints.issuer), authorization_endpoint: z.literal(endpoints.authorization),
        token_endpoint: z.literal(endpoints.token), jwks_uri: z.literal(endpoints.jwks) }).parse(await response.clone().json());
    }
    if (response.ok && url === endpoints.token) {
      const value = z.object({ id_token: z.string().min(1) }).parse(await response.clone().json());
      await jwtVerify(value.id_token, keys, { issuer: endpoints.issuer, audience: config.clientId,
        algorithms: ["RS256"], requiredClaims: ["sub", "iat", "exp", "nonce"] });
    }
    return response;
  };
}
