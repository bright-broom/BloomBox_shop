"use client";
import { useActionState, useMemo, useSyncExternalStore } from "react";
import type { ApprovalFormControl, ApprovalFormState } from "@/modules/fulfillment/public";
import { fulfillmentApprovalContent as copy } from "@/shared/infrastructure/content/fulfillment-approval-content";
import { createApprovalExpiry } from "./approval-expiry";

export function FulfillmentApprovalForm({ control, reviewPath, action }: {
  control: ApprovalFormControl;
  reviewPath: string;
  action: (previous: ApprovalFormState, form: FormData) => Promise<ApprovalFormState>;
}) {
  const [state, formAction, pending] = useActionState<ApprovalFormState, FormData>(action, { status: "IDLE" });
  const succeeded = state.status === "RECORDED" || state.status === "DUPLICATE";
  const preparedAt = control.status === "READY" ? control.preparedAt : null;
  const expiresAt = control.status === "READY" ? control.expiresAt : null;
  const expiry = useMemo(() => createApprovalExpiry(preparedAt, expiresAt), [preparedAt, expiresAt]);
  const expired = useSyncExternalStore(expiry.subscribe, expiry.getSnapshot, expiry.getServerSnapshot);
  return <section className="fulfillment-approval-form" aria-labelledby="approval-form-title">
    <h2 id="approval-form-title">{copy.title}</h2>
    <p>{copy.note}</p>
    {control.status === "READY" && control.intent && !succeeded ? <form action={formAction}
      onSubmit={(event) => { if (expiry.check()) event.preventDefault(); }}>
      <input type="hidden" name="intent" value={control.intent} />
      <p className="form-hint">{copy.deadline} <time dateTime={control.expiresAt}>{Number.isFinite(Date.parse(control.expiresAt))
        ? new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(new Date(control.expiresAt))
        : copy.expired}</time></p>
      <label className="fulfillment-approval-acknowledgement">
        <input type="checkbox" name="acknowledged" value="yes" required disabled={pending || expired} />
        <span>{copy.acknowledgement}</span>
      </label>
      <button className="primary-button" type="submit" disabled={pending || expired}>{pending ? copy.submitting : copy.submit}</button>
    </form> : control.status !== "READY" ? <p>{copy[control.status]}</p> : null}
    <p role={state.status !== "IDLE" && !succeeded ? "alert" : "status"} aria-live="polite">{copy.messages[state.status]}</p>
    <p role="status" aria-live="polite">{control.status === "READY" && expired && !pending && !succeeded ? copy.expired : ""}</p>
    <a className="text-link" href={reviewPath}>{copy.refresh}</a>
  </section>;
}
