"use client";
import { useActionState, useId, useState } from "react";
import { PERMISSION_REVOCATION_REASONS, type PermissionManagementState } from "@/modules/fulfillment/public";
import { operatorPermissionsContent as copy } from "@/shared/infrastructure/content/operator-permissions-content";

export function PermissionRevocationForm({ intent, action }: { intent: string;
  action: (previous: PermissionManagementState, form: FormData) => Promise<PermissionManagementState> }) {
  const [state, formAction, pending] = useActionState<PermissionManagementState, FormData>(action, { status: "IDLE" });
  const [reason, setReason] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const id = useId();
  const succeeded = state.status === "REVOKED" || state.status === "DUPLICATE";
  return <div className="permission-revocation-form">
    {!succeeded ? <form action={formAction} onReset={(event) => event.preventDefault()}>
      <input type="hidden" name="intent" value={intent} />
      <div className="form-field"><label htmlFor={id}>{copy.reason}</label>
        <select id={id} name="reason" required disabled={pending} value={reason} onChange={(event) => { setReason(event.target.value); setAcknowledged(false); }}>
          <option value="">{copy.selectReason}</option>
          {PERMISSION_REVOCATION_REASONS.map((value) => <option key={value} value={value}>{copy.reasons[value]}</option>)}
        </select></div>
      <label className="fulfillment-approval-acknowledgement"><input type="checkbox" name="acknowledged" value="yes" required disabled={pending}
        checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
        <span>{copy.acknowledgement}</span></label>
      <p className="form-hint">{copy.effect}</p>
      <button className="secondary-button permission-revoke-button" disabled={pending} type="submit">{pending ? copy.submitting : copy.submit}</button>
    </form> : null}
    <p role={state.status !== "IDLE" && !succeeded ? "alert" : "status"} aria-live="polite">{copy.messages[state.status]}</p>
  </div>;
}
