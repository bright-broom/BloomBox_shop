"use client";

import {
  GIFT_MESSAGE_MAX_LENGTH,
  GIFT_QUANTITY_MAX,
  GIFT_QUANTITY_MIN,
} from "@/modules/checkout/public";
import { createPurchaseIntentAction } from "@/modules/checkout/presentation/actions";
import {
  DELIVERY_BOOKING_WINDOW_DAYS,
  DELIVERY_LEAD_TIME_DAYS,
} from "@/modules/fulfillment/public";
import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { formatMoney, multiplyMoney, type Money } from "@/shared/domain/money";

export function GiftForm({
  productId,
  unitPrice,
  minDeliveryDate,
  maxDeliveryDate,
  requestId,
}: {
  productId: string;
  unitPrice: Money;
  minDeliveryDate: string;
  maxDeliveryDate: string;
  requestId: string;
}) {
  const [state, formAction, pending] = useActionState(createPurchaseIntentAction, {});
  const [quantity, setQuantity] = useState(GIFT_QUANTITY_MIN);
  const confirmationRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state.draft) confirmationRef.current?.focus();
  }, [state.draft]);

  useEffect(() => {
    if (state.checkout) window.location.assign(state.checkout.url);
  }, [state.checkout]);

  if (state.checkout) {
    return (
      <div className="draft-confirmation" role="status">
        <p className="eyebrow">SECURE CHECKOUT</p>
        <h2>安全な決済画面へ<br />移動しています。</h2>
      </div>
    );
  }

  if (state.draft) {
    return (
      <div className="draft-confirmation" ref={confirmationRef} role="status" tabIndex={-1}>
        <span className="confirmation-mark" aria-hidden="true">✓</span>
        <p className="eyebrow">GIFT DRAFT CREATED</p>
        <h2>ギフトの下書きが<br />できました。</h2>
        <p>
          入力内容を確認しました。プレビュー版のため、購入情報は保存されず、決済も発生しません。
        </p>
        <dl>
          <div><dt>受付番号</dt><dd>{state.draft.displayId}</dd></div>
          <div><dt>お花</dt><dd>{state.draft.productName}</dd></div>
          <div><dt>お届け予定</dt><dd>{state.draft.deliveryDate}</dd></div>
          <div><dt>参考価格</dt><dd>{state.draft.formattedTotal}</dd></div>
        </dl>
        <Link className="primary-button" href="/flowers">
          別の花を見る <span aria-hidden="true">→</span>
        </Link>
      </div>
    );
  }

  return (
    <form className="gift-form" action={formAction} noValidate>
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="productId" value={productId} />
      <div className="form-intro">
        <div>
          <p className="eyebrow">GIFT DETAILS</p>
          <h2>お届け内容</h2>
        </div>
        <span><i aria-hidden="true">*</i> 必須項目</span>
      </div>
      <div className="form-field">
        <label htmlFor="quantity"><span>01</span> 数量 <i aria-hidden="true">*</i></label>
        <select
          id="quantity"
          name="quantity"
          value={quantity}
          onChange={(event) => setQuantity(Number(event.target.value))}
          aria-describedby="quantity-summary quantity-error"
          required
        >
          {Array.from(
            { length: GIFT_QUANTITY_MAX - GIFT_QUANTITY_MIN + 1 },
            (_, index) => GIFT_QUANTITY_MIN + index,
          ).map((quantity) => <option key={quantity} value={quantity}>{quantity}点</option>)}
        </select>
        <p className="field-note" id="quantity-summary" aria-live="polite">
          商品小計 {formatMoney(multiplyMoney(unitPrice, quantity))}（税込・送料別）
        </p>
        <FieldError id="quantity-error" messages={state.fieldErrors?.quantity} />
      </div>
      <div className="form-field">
        <label htmlFor="recipientName"><span>02</span> お届けする方のお名前 <i aria-hidden="true">*</i></label>
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
        <label htmlFor="deliveryDate"><span>03</span> お届け希望日 <i aria-hidden="true">*</i></label>
        <input
          id="deliveryDate"
          name="deliveryDate"
          type="date"
          min={minDeliveryDate}
          max={maxDeliveryDate}
          aria-describedby="deliveryDate-note deliveryDate-error"
          required
        />
        <p className="field-note" id="deliveryDate-note">
          ご注文日の{DELIVERY_LEAD_TIME_DAYS}日後から{DELIVERY_BOOKING_WINDOW_DAYS}日後までお選びいただけます。
        </p>
        <FieldError id="deliveryDate-error" messages={state.fieldErrors?.deliveryDate} />
      </div>
      <div className="form-field">
        <div className="label-row">
          <label htmlFor="giftMessage"><span>04</span> 贈ることば <i aria-hidden="true">*</i></label>
          <span>{GIFT_MESSAGE_MAX_LENGTH}文字まで</span>
        </div>
        <textarea
          id="giftMessage"
          name="giftMessage"
          rows={5}
          maxLength={GIFT_MESSAGE_MAX_LENGTH}
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
