"use client";

import { createOrderAction } from "@/modules/order/presentation/actions";
import { useActionState } from "react";

export function GiftForm({
  productId,
  minDeliveryDate,
}: {
  productId: string;
  minDeliveryDate: string;
}) {
  const [state, formAction, pending] = useActionState(createOrderAction, {});

  return (
    <form className="gift-form" action={formAction} noValidate>
      <input type="hidden" name="productId" value={productId} />
      <div className="form-intro">
        <div>
          <p className="eyebrow">GIFT DETAILS</p>
          <h2>お届け内容</h2>
        </div>
        <span><i aria-hidden="true">*</i> 必須項目</span>
      </div>
      <div className="form-field">
        <label htmlFor="recipientName"><span>01</span> お届けする方のお名前 <i aria-hidden="true">*</i></label>
        <input
          id="recipientName"
          name="recipientName"
          autoComplete="name"
          placeholder="例：山田 花子"
          aria-describedby="recipientName-error"
          required
        />
        <FieldError id="recipientName-error" messages={state.fieldErrors?.recipientName} />
      </div>
      <div className="form-field">
        <label htmlFor="deliveryDate"><span>02</span> お届け希望日 <i aria-hidden="true">*</i></label>
        <input
          id="deliveryDate"
          name="deliveryDate"
          type="date"
          min={minDeliveryDate}
          aria-describedby="deliveryDate-note deliveryDate-error"
          required
        />
        <p className="field-note" id="deliveryDate-note">ご注文日の3日後からお選びいただけます。</p>
        <FieldError id="deliveryDate-error" messages={state.fieldErrors?.deliveryDate} />
      </div>
      <div className="form-field">
        <div className="label-row">
          <label htmlFor="giftMessage"><span>03</span> 贈ることば <i aria-hidden="true">*</i></label>
          <span>180文字まで</span>
        </div>
        <textarea
          id="giftMessage"
          name="giftMessage"
          rows={5}
          maxLength={180}
          placeholder="伝えたい気持ちを、あなたの言葉で。"
          aria-describedby="giftMessage-error"
          required
        />
        <FieldError id="giftMessage-error" messages={state.fieldErrors?.giftMessage} />
      </div>
      {state.error ? <p className="form-error" role="alert">{state.error}</p> : null}
      <button className="primary-button form-submit" type="submit" disabled={pending}>
        {pending ? "ご注文を準備しています…" : "内容を確認する"}
        <span aria-hidden="true">→</span>
      </button>
      <p className="secure-note">この時点では決済は発生しません</p>
    </form>
  );
}

function FieldError({ id, messages }: { id: string; messages?: readonly string[] }) {
  return (
    <p className="field-error" id={id} role={messages?.length ? "alert" : undefined}>
      {messages?.[0] ?? ""}
    </p>
  );
}
