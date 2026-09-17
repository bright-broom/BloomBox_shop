"use client";
import { startTransition, useActionState, useId, useState } from "react";
import { TRACKING_NUMBER_INPUT_MAX_LENGTH, NATIVE_FULFILLMENT_ACTIONS, NATIVE_CARRIER_CODES, NATIVE_FULFILLMENT_HOLD_REASONS, NATIVE_FULFILLMENT_CANCEL_REASONS,
  type NativeCarrierCode, type NativeFulfillmentHoldReason, type NativeFulfillmentCancelReason, type NativeFulfillmentAction, type NativeFulfillmentDetail, type NativeFulfillmentFormState } from "@/modules/fulfillment/public";
import { nativeFulfillmentContent as copy } from "@/shared/infrastructure/content/native-fulfillment-content";
export function NativeFulfillmentForm({ detail, requestId, action }: {
  detail: Pick<NativeFulfillmentDetail, "fulfillmentId" | "version" | "shipment">; requestId: string;
  action: (previous: NativeFulfillmentFormState, form: FormData) => Promise<NativeFulfillmentFormState>;
}) {
  const [state, submit, pending] = useActionState<NativeFulfillmentFormState, FormData>(action, { status: "IDLE" });
  const [operation, setOperation] = useState<NativeFulfillmentAction>("START_PREPARATION");
  // React Actions reset uncontrolled inputs even when a returned result is an expected error.
  // Keep edits controlled so a conflict/unavailable response does not discard the operator's work.
  const [carrier, setCarrier] = useState<NativeCarrierCode>(detail.shipment?.carrier ?? "YAMATO");
  const [trackingNumber, setTrackingNumber] = useState(detail.shipment?.trackingNumber ?? "");
  const [holdReason, setHoldReason] = useState<NativeFulfillmentHoldReason>("PAYMENT_REVIEW");
  const [cancelReason, setCancelReason] = useState<NativeFulfillmentCancelReason>("CUSTOMER_REQUEST");
  const [confirmed, setConfirmed] = useState(false);
  const prefix = useId();
  const reasons = operation === "HOLD" ? NATIVE_FULFILLMENT_HOLD_REASONS : operation === "CANCEL" ? NATIVE_FULFILLMENT_CANCEL_REASONS : [];
  return <div><form method="post" onSubmit={(event) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    startTransition(() => submit(values));
  }} className="catalog-management-form">
    <input type="hidden" name="fulfillmentId" value={detail.fulfillmentId} /><input type="hidden" name="expectedVersion" value={detail.version} /><input type="hidden" name="requestId" value={requestId} />
    <fieldset disabled={pending || state.status === "SAVED"}><legend>{copy.action}</legend>
      <div className="form-field"><label htmlFor={`${prefix}-action`}>{copy.action}</label><select id={`${prefix}-action`} name="action" value={operation} onChange={(event) => {
        const next = NATIVE_FULFILLMENT_ACTIONS.find((value) => value === event.target.value); if (next) setOperation(next);
      }}>{NATIVE_FULFILLMENT_ACTIONS.map((value) => <option key={value} value={value}>{copy.actions[value]}</option>)}</select></div>
      {reasons.length ? <div className="form-field"><label htmlFor={`${prefix}-reason`}>{copy.reason}</label><select id={`${prefix}-reason`} name="reason" value={operation === "HOLD" ? holdReason : cancelReason} onChange={(event) => {
        if (operation === "HOLD") { const value = NATIVE_FULFILLMENT_HOLD_REASONS.find((reason) => reason === event.target.value); if (value) setHoldReason(value); }
        if (operation === "CANCEL") { const value = NATIVE_FULFILLMENT_CANCEL_REASONS.find((reason) => reason === event.target.value); if (value) setCancelReason(value); }
      }}>{reasons.map((value) => <option value={value} key={value}>{copy.reasons[value]}</option>)}</select></div> : null}
      {operation === "SHIP" || operation === "CORRECT_TRACKING" ? <><div className="form-field"><label htmlFor={`${prefix}-carrier`}>{copy.carrier}</label><select id={`${prefix}-carrier`} name="carrier" value={carrier} onChange={(event) => { const value = NATIVE_CARRIER_CODES.find((code) => code === event.target.value); if (value) setCarrier(value); }}>{NATIVE_CARRIER_CODES.map((value) => <option key={value} value={value}>{copy.carriers[value]}</option>)}</select></div>
        <div className="form-field"><label htmlFor={`${prefix}-tracking`}>{copy.tracking}</label><input id={`${prefix}-tracking`} name="trackingNumber" required maxLength={TRACKING_NUMBER_INPUT_MAX_LENGTH} value={trackingNumber} onChange={(event) => setTrackingNumber(event.target.value)} aria-describedby={`${prefix}-tracking-hint`} /><p className="field-note" id={`${prefix}-tracking-hint`}>{copy.trackingHint}</p></div></> : null}
      <p>{copy.warning}</p><label><input type="checkbox" name="confirmed" value="yes" required checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> {copy.confirm}</label>
      <button className="primary-button" type="submit">{pending ? copy.saving : copy.save}</button>
    </fieldset></form>
    {state.status !== "IDLE" ? <p role={state.status === "SAVED" ? "status" : "alert"}>{copy.messages[state.status]}</p> : null}
    <a className="text-link" href={`/operations/native-fulfillments/${detail.fulfillmentId}`}>{copy.reload}</a>
  </div>;
}
