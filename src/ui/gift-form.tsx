"use client";

import {
  GIFT_MESSAGE_MAX_LENGTH,
  GIFT_QUANTITY_MAX,
  GIFT_QUANTITY_MIN,
} from "@/modules/checkout/public";
import {
  createPurchaseIntentSchema,
  type CreatePurchaseIntentFormState,
} from "@/modules/checkout/presentation/create-purchase-intent-schema";
import { storeCart } from "@/modules/checkout/presentation/browser-checkout-session";
import {
  DELIVERY_BOOKING_WINDOW_DAYS,
  DELIVERY_LEAD_TIME_DAYS,
} from "@/modules/fulfillment/public";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { formatMoney, multiplyMoney, type Money } from "@/shared/domain/money";

export function GiftForm({
  productId,
  productName,
  unitPrice,
  minDeliveryDate,
  maxDeliveryDate,
  requestId,
}: {
  productId: string;
  productName: string;
  unitPrice: Money;
  minDeliveryDate: string;
  maxDeliveryDate: string;
  requestId: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<CreatePurchaseIntentFormState>({});
  const [pending, setPending] = useState(false);
  const [quantity, setQuantity] = useState(GIFT_QUANTITY_MIN);

  function addToCart(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    const formData = new FormData(event.currentTarget);
    const parsed = createPurchaseIntentSchema.safeParse({
      requestId: formData.get("requestId"),
      productId: formData.get("productId"),
      quantity: formData.get("quantity"),
      recipientName: formData.get("recipientName"),
      deliveryDate: formData.get("deliveryDate"),
      giftMessage: formData.get("giftMessage"),
    });

    if (!parsed.success) {
      setState({ fieldErrors: parsed.error.flatten().fieldErrors });
      setPending(false);
      const firstField = event.currentTarget.elements.namedItem(String(parsed.error.issues[0]?.path[0] ?? ""));
      if (firstField instanceof HTMLElement) firstField.focus();
      return;
    }

    try {
      storeCart(window.sessionStorage, {
        version: 1,
        ...parsed.data,
        productName,
        unitAmount: unitPrice.amount,
      });
      router.push("/cart?added=1");
    } catch {
      setState({ error: "カートに追加できませんでした。ブラウザーの設定をご確認ください。" });
      setPending(false);
    }
  }

  return (
    <form className="gift-form" onSubmit={addToCart} noValidate>
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
          aria-invalid={Boolean(state.fieldErrors?.quantity?.length)}
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
          ).map((quantity) => <option key={quantity} value={quantity}>{quantity} 点</option>)}
        </select>
        <p className="field-note" id="quantity-summary" aria-live="polite">
          商品小計 {formatMoney(multiplyMoney(unitPrice, quantity))}（税込・送料別）
        </p>
        <FieldError id="quantity-error" messages={state.fieldErrors?.quantity} />
      </div>
      <div className="form-field">
        <label htmlFor="recipientName"><span>02</span> お届けする方のお名前 <i aria-hidden="true">*</i></label>
        <input
          aria-invalid={Boolean(state.fieldErrors?.recipientName?.length)}
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
          aria-invalid={Boolean(state.fieldErrors?.deliveryDate?.length)}
          id="deliveryDate"
          name="deliveryDate"
          type="date"
          min={minDeliveryDate}
          max={maxDeliveryDate}
          aria-describedby="deliveryDate-note deliveryDate-error"
          required
        />
        <p className="field-note" id="deliveryDate-note">
          ご注文日の {DELIVERY_LEAD_TIME_DAYS} 日後から {DELIVERY_BOOKING_WINDOW_DAYS} 日後までお選びいただけます。
        </p>
        <FieldError id="deliveryDate-error" messages={state.fieldErrors?.deliveryDate} />
      </div>
      <div className="form-field">
        <div className="label-row">
          <label htmlFor="giftMessage"><span>04</span> 贈ることば <i aria-hidden="true">*</i></label>
          <span>{GIFT_MESSAGE_MAX_LENGTH} 文字まで</span>
        </div>
        <textarea
          aria-invalid={Boolean(state.fieldErrors?.giftMessage?.length)}
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
        {pending ? "カートに追加しています…" : "カートに入れる"}
        <span aria-hidden="true">→</span>
      </button>
      <p className="secure-note">カートに入れた時点では、注文も決済も発生しません</p>
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
