"use client";
import { useActionState } from "react";
import type { ApprovalFormControl, ApprovalFormState } from "@/modules/fulfillment/public";
import { fulfillmentApprovalContent as copy } from "@/shared/infrastructure/content/fulfillment-approval-content";

export function FulfillmentApprovalForm({ control, reviewPath, action }: {
  control: ApprovalFormControl;
  reviewPath: string;
  action: (previous: ApprovalFormState, form: FormData) => Promise<ApprovalFormState>;
}) {
  const [state, formAction, pending] = useActionState<ApprovalFormState, FormData>(action, { status: "IDLE" });
  const succeeded = state.status === "RECORDED" || state.status === "DUPLICATE";
  return <section className="fulfillment-approval-form" aria-labelledby="approval-form-title">
    <h2 id="approval-form-title">{copy.title}</h2>
    <p>{copy.note}</p>
    {control.status === "READY" && control.intent && !succeeded ? <form action={formAction}>
      <input type="hidden" name="intent" value={control.intent} />
      <label className="fulfillment-approval-acknowledgement">
        <input type="checkbox" name="acknowledged" value="yes" required disabled={pending} />
        <span>{copy.acknowledgement}</span>
      </label>
      <button className="primary-button" type="submit" disabled={pending}>{pending ? copy.submitting : copy.submit}</button>
    </form> : control.status !== "READY" ? <p>{copy[control.status]}</p> : null}
    <p role={state.status !== "IDLE" && !succeeded ? "alert" : "status"} aria-live="polite">{copy.messages[state.status]}</p>
    <a className="text-link" href={reviewPath}>{copy.refresh}</a>
  </section>;
}
