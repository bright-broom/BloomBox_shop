import { createHash, timingSafeEqual } from "node:crypto";
import { loadCommerceWorkerSecret } from "@/shared/infrastructure/config/worker-config";

/**
 * Protected internal commerce endpoints accept only the configured worker secret as a bearer token.
 * Digests are compared in constant time so neither the secret nor its length leaks through timing.
 */
export function isAuthorizedCommerceWorkerRequest(request: Request, secret: string = loadCommerceWorkerSecret()): boolean {
  const expected = `Bearer ${secret}`;
  const actual = request.headers.get("authorization") ?? "";
  const expectedDigest = createHash("sha256").update(expected).digest();
  const actualDigest = createHash("sha256").update(actual).digest();
  return timingSafeEqual(actualDigest, expectedDigest) && actual.length === expected.length;
}
