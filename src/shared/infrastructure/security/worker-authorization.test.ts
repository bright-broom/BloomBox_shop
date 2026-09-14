import { describe, expect, it } from "vitest";
import { isAuthorizedCommerceWorkerRequest } from "./worker-authorization";

const secret = "a-secure-worker-secret-with-32-chars";

function request(authorization?: string) {
  return new Request(new URL("worker", import.meta.url), {
    method: "POST",
    headers: authorization === undefined ? {} : { authorization },
  });
}

describe("commerce worker authorization", () => {
  it("accepts only the exact bearer secret", () => {
    expect(isAuthorizedCommerceWorkerRequest(request(`Bearer ${secret}`), secret)).toBe(true);
  });

  it.each([
    undefined,
    "",
    secret,
    `Bearer ${secret}x`,
    `Bearer ${secret.slice(0, -1)}`,
    `bearer ${secret}`,
  ])("rejects a missing or different credential: %j", (authorization) => {
    expect(isAuthorizedCommerceWorkerRequest(request(authorization), secret)).toBe(false);
  });
});
