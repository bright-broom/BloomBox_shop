import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encode } from "next-auth/jwt";
import { getOperatorAuth } from "./operator-auth";
import { readOperatorInbox } from "./read-operator-inbox";
import { readOperatorReview } from "./read-operator-review";
import { prepareOperatorApproval, recordOperatorApproval } from "./operator-approval";
import { preparePermissionManagement, revokeOperatorPermission } from "./operator-permissions";
import { OperatorApprovalIntent } from "./approval-intent";
import { OperatorRevocationIntent } from "./revocation-intent";

const mocks = vi.hoisted(() => ({ headers: vi.fn(), operatorDatabase: vi.fn(), managerDatabase: vi.fn() }));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("../../database/database-connections", () => ({
  getOperatorDatabaseClient: mocks.operatorDatabase, getPermissionManagerDatabaseClient: mocks.managerDatabase,
}));
const origin = "https://operators.example", secret = "synthetic-revocation-secret-".repeat(3);
const cookieName = "__Host-bloombox.operator-session";
const operatorId = "00000000-0000-4000-8000-000000000001";
const targetId = "00000000-0000-4000-8000-000000000002", shop = "example.myshopify.com";
const binding = { subject: "12345", operatorId, sessionVersion: 0 };

beforeEach(() => {
  vi.resetAllMocks();
  for (const [name, value] of Object.entries({ AUTH_OPERATOR_ENABLED: "true", AUTH_URL: origin, AUTH_SECRET: secret,
    AUTH_GOOGLE_ID: "synthetic.apps.googleusercontent.com", AUTH_GOOGLE_SECRET: "synthetic-google-secret",
    AUTH_OPERATOR_EMAILS: "operator@example.com", AUTH_OPERATOR_BINDINGS: JSON.stringify([binding]) })) vi.stubEnv(name, value);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("revoked session access through real Auth.js server authentication", () => {
  it.each(["version", "removed", "rebound"] as const)("denies reads and previously prepared mutations before database access: %s", async (change) => {
    const expiresAt = new Date(Date.now() + 600_000);
    const token = await encode({ secret, salt: cookieName, maxAge: 900,
      token: { googleSubject: "12345", operatorEmail: "operator@example.com", operatorId, sessionVersion: 0, loginExpiresAt: expiresAt.getTime() } });
    mocks.headers.mockResolvedValue(new Headers({ host: "operators.example", "x-forwarded-proto": "https", cookie: `${cookieName}=${token}` }));
    // Positive control: this same encrypted cookie resolves through the real server auth entry point.
    expect(await getOperatorAuth()!.auth.auth()).toEqual({ user: { id: "12345" }, expires: expiresAt.toISOString() });
    const actor = { operatorId, expiresAt };
    const approval = new FormData(); approval.set("acknowledged", "yes");
    approval.set("intent", await new OperatorApprovalIntent(secret, origin).issue({ shop, fulfillmentId: targetId, reviewedIntakeVersion: 1 }, actor, true));
    const revocation = new FormData(); revocation.set("acknowledged", "yes"); revocation.set("reason", "ROLE_CHANGE");
    revocation.set("intent", await new OperatorRevocationIntent(secret, origin).issue({ shop, permissionId: targetId, reviewedVersion: 1 }, actor, true));
    vi.stubEnv("AUTH_OPERATOR_BINDINGS", JSON.stringify(change === "removed" ? []
      : [{ ...binding, ...(change === "version" ? { sessionVersion: 1 } : { operatorId: targetId }) }]));
    expect(await getOperatorAuth()!.auth.auth()).toBeNull();
    for (const operation of [() => readOperatorInbox({ shop }), () => readOperatorReview({ shop, fulfillmentId: targetId }),
      () => prepareOperatorApproval({ shop, fulfillmentId: targetId }), () => preparePermissionManagement({ shop }),
      () => recordOperatorApproval(approval, origin), () => revokeOperatorPermission(revocation, origin)]) {
      await expect(operation()).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
    }
    expect(mocks.operatorDatabase).not.toHaveBeenCalled(); expect(mocks.managerDatabase).not.toHaveBeenCalled();
  });
});
