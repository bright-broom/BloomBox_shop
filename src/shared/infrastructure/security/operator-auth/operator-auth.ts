import NextAuth from "next-auth";
import { loadOperatorAuthConfig, type OperatorAuthConfig } from "../../config/operator-auth-config";
import { createOperatorAuthOptions } from "./auth-config";

/** Create per request: allowlist/binding changes must not be hidden by a cached identity/configuration. */
export function getOperatorAuth() {
  const config = loadOperatorAuthConfig();
  return config ? { config, auth: NextAuth(createOperatorAuthOptions(config)) } : null;
}
export function isOperatorOrigin(request: Request, config: OperatorAuthConfig): boolean {
  return new URL(request.url).origin === config.origin && (request.method === "GET" || request.headers.get("origin") === config.origin);
}
