import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FulfillmentApprovalForm } from "@/ui/fulfillment-approval-form";
import { fulfillmentApprovalContent as copy } from "../../content/fulfillment-approval-content";
import type { ApprovalFormState } from "@/modules/fulfillment/public";
const hook = vi.hoisted(() => ({ state: { status: "IDLE" } as ApprovalFormState, pending: false }));
vi.mock("react", async (original) => ({ ...await original<typeof import("react")>(), useActionState: () => [hook.state, "/synthetic-action", hook.pending] }));
const action = async (): Promise<ApprovalFormState> => ({ status: "RECORDED" });
beforeEach(() => { hook.state = { status: "IDLE" }; hook.pending = false; });
describe("approval form states", () => {
  it("requires explicit acknowledgement and posts only an opaque intent", () => {
    const html = renderToStaticMarkup(<FulfillmentApprovalForm action={action} reviewPath="/review" control={{ status: "READY", intent: "encrypted-context" }} />);
    expect(html).toContain('name="intent"'); expect(html).toContain('name="acknowledged"'); expect(html).toContain('required=""');
    expect(html).toContain(copy.note); expect(html).not.toMatch(/name="(?:shop|operatorId|reviewedIntakeVersion|isAdmin)"/);
  });
  it.each(["POLICY_PENDING", "REVIEW_REQUIRED", "RECORDED"] as const)("keeps %s non-actionable", (status) => {
    const html = renderToStaticMarkup(<FulfillmentApprovalForm action={action} reviewPath="/review" control={{ status, intent: null }} />);
    expect(html).toContain(copy[status]); expect(html).not.toContain("<form"); expect(html).not.toContain("<button");
  });
  it("disables submission while pending and retains a safe retry on an uncertain result", () => {
    hook.pending = true;
    let html = renderToStaticMarkup(<FulfillmentApprovalForm action={action} reviewPath="/review" control={{ status: "READY", intent: "same-intent" }} />);
    expect(html).toContain(copy.submitting); expect(html).toContain('disabled=""');
    hook.pending = false; hook.state = { status: "UNAVAILABLE" };
    html = renderToStaticMarkup(<FulfillmentApprovalForm action={action} reviewPath="/review" control={{ status: "READY", intent: "same-intent" }} />);
    expect(html).toContain(copy.messages.UNAVAILABLE); expect(html).toContain('value="same-intent"'); expect(html).toContain('role="alert"');
    hook.state = { status: "RECORDED" };
    html = renderToStaticMarkup(<FulfillmentApprovalForm action={action} reviewPath="/review" control={{ status: "READY", intent: "same-intent" }} />);
    expect(html).toContain(copy.messages.RECORDED); expect(html).not.toContain("<form");
  });
  it("announces throttling while retaining the original context for a later retry", () => {
    hook.state = { status: "RATE_LIMITED" };
    const html = renderToStaticMarkup(<FulfillmentApprovalForm action={action} reviewPath="/review" control={{ status: "READY", intent: "same-intent" }} />);
    expect(html).toContain(copy.messages.RATE_LIMITED); expect(html).toContain('role="alert"');
    expect(html).toContain('value="same-intent"'); expect(html).not.toContain('disabled=""');
  });
});
