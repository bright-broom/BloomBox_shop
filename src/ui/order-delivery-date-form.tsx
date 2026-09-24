"use client";
import { startTransition, useActionState, useId, useState } from "react";
import { ORDER_DELIVERY_DATE_REASON_MAX_LENGTH, type OrderDeliveryDateFormState, type OrderDeliveryDateWindow } from "@/modules/order/public";
import { nativeFulfillmentContent } from "@/shared/infrastructure/content/native-fulfillment-content";

const copy = nativeFulfillmentContent.reschedule;

export function OrderDeliveryDateForm({ order, window: range, requestId, action }: {
  order: Readonly<{ orderId: string; deliveryDate: string }>;
  window: OrderDeliveryDateWindow;
  requestId: string;
  action: (previous: OrderDeliveryDateFormState, form: FormData) => Promise<OrderDeliveryDateFormState>;
}) {
  const [state, submit, pending] = useActionState<OrderDeliveryDateFormState, FormData>(action, { status: "IDLE" });
  // Keep the operator's edits after an expected error; React Actions reset uncontrolled inputs.
  const [nextDate, setNextDate] = useState(order.deliveryDate);
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const prefix = useId();
  return <div><h2>{copy.title}</h2><p className="field-note">{copy.note}</p>
    <form method="post" className="catalog-management-form" onSubmit={(event) => {
      event.preventDefault();
      const values = new FormData(event.currentTarget);
      startTransition(() => submit(values));
    }}>
      <input type="hidden" name="orderId" value={order.orderId} />
      <input type="hidden" name="expectedDate" value={order.deliveryDate} />
      <input type="hidden" name="requestId" value={requestId} />
      <fieldset disabled={pending || state.status === "SAVED"}><legend>{copy.title}</legend>
        <p>{copy.current}：<time dateTime={order.deliveryDate}>{order.deliveryDate}</time></p>
        <div className="form-field"><label htmlFor={`${prefix}-date`}>{copy.date}</label>
          <input id={`${prefix}-date`} name="nextDate" type="date" required min={range.earliest} max={range.latest}
            value={nextDate} onChange={(event) => setNextDate(event.target.value)} aria-describedby={`${prefix}-range`} />
          <p className="field-note" id={`${prefix}-range`}>{copy.range.replace("{earliest}", range.earliest).replace("{latest}", range.latest)}</p></div>
        <div className="form-field"><label htmlFor={`${prefix}-reason`}>{copy.reason}</label>
          <textarea id={`${prefix}-reason`} name="reason" required rows={2} maxLength={ORDER_DELIVERY_DATE_REASON_MAX_LENGTH}
            value={reason} onChange={(event) => setReason(event.target.value)} aria-describedby={`${prefix}-reason-hint`} />
          <p className="field-note" id={`${prefix}-reason-hint`}>{copy.reasonHint}</p></div>
        <label><input type="checkbox" name="confirmed" value="yes" required checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)} /> {copy.confirm}</label>
        <button className="primary-button" type="submit">{pending ? copy.saving : copy.save}</button>
      </fieldset>
    </form>
    {state.status !== "IDLE" ? <p role={state.status === "SAVED" ? "status" : "alert"}>{copy.messages[state.status]}</p> : null}
  </div>;
}
