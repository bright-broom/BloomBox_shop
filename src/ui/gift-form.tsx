"use client";

import { giftExperienceContent } from "@/shared/infrastructure/content/gift-experience-content";
import { recordPreviewMetric } from "@/shared/infrastructure/preview-metrics";
import { previewTotals, LAUNCH_PREVIEW_QUANTITY } from "@/modules/checkout/public";
import {
  GIFT_MESSAGE_MAX_LENGTH,
  GIFT_QUANTITY_MAX,
  GIFT_QUANTITY_MIN,
} from "@/modules/checkout/public";
import {
  createPurchaseIntentSchema,
  type CreatePurchaseIntentFormState,
} from "@/modules/checkout/presentation/create-purchase-intent-schema";
import { CartChangedError, readRecoverableCart, storeCart, type BrowserCartItem } from "@/modules/checkout/presentation/browser-checkout-session";
import {
  isAvailableDeliveryDate,
  DELIVERY_BOOKING_WINDOW_DAYS,
  DELIVERY_LEAD_TIME_DAYS,
} from "@/modules/fulfillment/public";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useCheckoutSessionRevision } from "@/ui/use-checkout-session-revision";
import { formatMoney, multiplyMoney, type Money } from "@/shared/domain/money";

type SizeOption = { id: string; name: string; size: "M" | "L"; price: Money; shippingAmount: number };

type GiftFormProps = {
  sizeOptions?: readonly SizeOption[];
  productId: string;
  productName: string;
  unitPrice: Money;
  minDeliveryDate: string;
  maxDeliveryDate: string;
};

export function GiftForm(props: GiftFormProps) {
  const revision = useCheckoutSessionRevision();
  if (revision === null) return <p className="checkout-loading" role="status">ギフトの設定を確認しています…</p>;
  return <GiftConfigurationForm key={props.productId} {...props} initialCart={readRecoverableCart(window.sessionStorage)} />;
}

function GiftConfigurationForm({
  productId: initialProductId, productName: initialProductName, unitPrice: initialUnitPrice, minDeliveryDate, maxDeliveryDate, initialCart, sizeOptions = [],
}: GiftFormProps & { initialCart: BrowserCartItem | null }) {
  // Snapshot the cart once: a background revision must not overwrite in-progress typing.
  const [cartAtOpen] = useState(initialCart);
  const editingCart = cartAtOpen && (cartAtOpen.productId === initialProductId || sizeOptions.some((option) => option.id === cartAtOpen.productId)) ? cartAtOpen : null;
  const [selectedId, setSelectedId] = useState(initialProductId);
  const selection = sizeOptions.find((option) => option.id === selectedId);
  const productId = selection?.id ?? initialProductId;
  const productName = selection?.name ?? initialProductName;
  const unitPrice = selection?.price ?? initialUnitPrice;
  const copy = giftExperienceContent.launch;
  const replacingCart = Boolean(cartAtOpen && !editingCart);
  const [replacementAccepted, setReplacementAccepted] = useState(false);
  const router = useRouter();
  const [state, setState] = useState<CreatePurchaseIntentFormState>({});
  const [pending, setPending] = useState(false);
  const [quantity, setQuantity] = useState(sizeOptions.length ? LAUNCH_PREVIEW_QUANTITY : editingCart?.quantity ?? GIFT_QUANTITY_MIN);

  function addToCart(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || (replacingCart && !replacementAccepted)) return;
    setPending(true);
    const formData = new FormData(event.currentTarget);
    const parsed = createPurchaseIntentSchema.safeParse({
      requestId: crypto.randomUUID(),
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
      }, cartAtOpen?.requestId ?? null);
      router.push("/cart?added=1");
    } catch (error) {
      setState({ error: error instanceof CartChangedError ? error.message : "カートに保存できませんでした。ブラウザーの設定をご確認ください。" });
      setPending(false);
    }
  }

  return (
    <form className="gift-form" onSubmit={addToCart} noValidate>
      <input type="hidden" name="productId" value={productId} />
      {editingCart ? (
        <div className="checkout-notice" role="status">
          カートの内容を復元しました。変更は保存するまで反映されません。
          {!isAvailableDeliveryDate(editingCart.deliveryDate) ? <p>お届け希望日が期限外になっています。新しい日付を選択してください。</p> : null}
        </div>
      ) : null}
      {replacingCart ? (
        <div className="checkout-notice">
          <p>カートには「{cartAtOpen?.productName}」が入っています。現在は1種類の花を贈れます。</p>
          <label className="consent-field">
            <input type="checkbox" checked={replacementAccepted} onChange={(event) => setReplacementAccepted(event.target.checked)} />
            <span>今のギフトをこの花に入れ替える</span>
          </label>
          <Link className="text-link" href="/cart">今のカートに戻る</Link>
        </div>
      ) : null}
      <div className="form-intro">
        <div>
          <p className="eyebrow">GIFT DETAILS</p>
          <h2>お届け内容</h2>
        </div>
        <span><i aria-hidden="true">*</i> 必須項目</span>
      </div>
      {selection ? <div className="form-field">
        <label htmlFor="gift-size">{copy.sizeLabel}</label>
        <select id="gift-size" value={selectedId} disabled={pending} onChange={(event) => { setSelectedId(event.target.value); const option = sizeOptions.find((option) => option.id === event.target.value); if (option) recordPreviewMetric({ name: "size_select", size: option.size }); }} aria-describedby="size-help">
          {sizeOptions.map((option) => <option key={option.id} value={option.id}>{option.size} — {formatMoney(option.price)} / {copy.totalLabel} {formatMoney({ ...option.price, amount: previewTotals(option.price.amount, option.shippingAmount).totalAmount })}</option>)}
        </select>
        <p id="size-help" className="field-note">{copy.sizeChangeNote}</p>
        <dl className="checkout-details"><div><dt>{copy.productLabel}</dt><dd>{formatMoney(unitPrice)}</dd></div><div><dt>{copy.shippingLabel}</dt><dd>{formatMoney({ ...unitPrice, amount: selection.shippingAmount })}</dd></div><div><dt>{copy.totalLabel}</dt><dd>{formatMoney({ ...unitPrice, amount: previewTotals(unitPrice.amount, selection.shippingAmount).totalAmount })}</dd></div></dl>
        <p className="field-note">{copy.taxNote}。{copy.quantityNote}</p>
      </div> : null}
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
            { length: selection ? 1 : GIFT_QUANTITY_MAX - GIFT_QUANTITY_MIN + 1 },
            (_, index) => GIFT_QUANTITY_MIN + index,
          ).map((quantity) => <option key={quantity} value={quantity}>{quantity} 点</option>)}
        </select>
        <p className="field-note" id="quantity-summary" aria-live="polite">
          商品小計 {formatMoney(multiplyMoney(unitPrice, quantity))}（{selection ? copy.taxNote : "税込・送料別"}）
        </p>
        <FieldError id="quantity-error" messages={state.fieldErrors?.quantity} />
      </div>
      <div className="form-field">
        <label htmlFor="recipientName"><span>02</span> お届けする方のお名前 <i aria-hidden="true">*</i></label>
        <input
          aria-invalid={Boolean(state.fieldErrors?.recipientName?.length)}
          id="recipientName"
          defaultValue={editingCart?.recipientName ?? ""}
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
          defaultValue={editingCart?.deliveryDate ?? ""}
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
          defaultValue={editingCart?.giftMessage ?? ""}
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
      <button className="primary-button form-submit" type="submit" disabled={pending || (replacingCart && !replacementAccepted)}>
        {pending ? "保存しています…" : editingCart ? "変更を保存する" : "カートに入れる"}
        <span aria-hidden="true">→</span>
      </button>
      {cartAtOpen ? <Link className="text-link" href="/cart">保存せずカートに戻る</Link> : null}
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
