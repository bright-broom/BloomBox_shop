import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PermissionRevocationForm } from "@/ui/permission-revocation-form";
import { OperatorPermissions } from "@/ui/operator-permissions";
import type { PermissionManagementPage, PermissionManagementState } from "@/modules/fulfillment/public";
import { operatorPermissionsContent as copy } from "../../content/operator-permissions-content";
const hook = vi.hoisted(() => ({ status: "IDLE" as PermissionManagementState["status"], pending: false }));
vi.mock("react", async (original) => ({ ...await original<typeof import("react")>(),
  useActionState: () => [{ status: hook.status }, "/synthetic-action", hook.pending] }));
const action = async (): Promise<PermissionManagementState> => ({ status: "REVOKED" });
beforeEach(() => { hook.status = "IDLE"; hook.pending = false; });
describe("permission form and history", () => {
  it("requires a fixed reason and acknowledgement with only opaque target context", () => {
    const html = renderToStaticMarkup(<PermissionRevocationForm action={action} intent="same-context" />);
    expect(html).toContain('name="reason"'); expect(html).toContain('name="acknowledged"'); expect(html).toContain('required=""');
    expect(html).not.toMatch(/name="(?:shop|operatorId|permissionId|reviewedVersion)"/); expect(html).toContain(copy.effect);
  });
  it("disables pending work and preserves context on retry but hides successful forms", () => {
    hook.pending = true;
    expect(renderToStaticMarkup(<PermissionRevocationForm action={action} intent="same-context" />)).toContain('disabled=""');
    hook.pending = false; hook.status = "RATE_LIMITED";
    const limited = renderToStaticMarkup(<PermissionRevocationForm action={action} intent="same-context" />);
    expect(limited).toContain(copy.messages.RATE_LIMITED); expect(limited).toContain('value="same-context"'); expect(limited).toContain('role="alert"');
    hook.status = "REVOKED";
    expect(renderToStaticMarkup(<PermissionRevocationForm action={action} intent="same-context" />)).not.toContain("<form");
  });
  it("displays historical revocation as history and keeps disabled entries non-actionable", () => {
    const page: PermissionManagementPage = { shop: "example.myshopify.com", viewedAt: "2026-09-12T01:00:00Z", nextCursor: null,
      entries: [{ id: "permission", operatorId: "target-registration", enabled: false, validUntil: "2026-10-01T00:00:00Z", version: 2,
        intent: null, latestRevocation: { operatorId: "manager-registration", version: 2, reason: "ROLE_CHANGE", revokedAt: "2026-09-12T00:00:00Z" } }] };
    const html = renderToStaticMarkup(<OperatorPermissions page={page} action={action} />);
    expect(html).toContain(copy.disabled); expect(html).toContain(copy.history); expect(html).toContain("manager-registration");
    expect(html).not.toContain("<form");
    expect(renderToStaticMarkup(<OperatorPermissions page={{ ...page, entries: [] }} action={action} />)).toContain(copy.empty);
  });
});
