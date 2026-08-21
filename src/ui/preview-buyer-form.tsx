"use client";

import {
  JAPAN_PREFECTURES,
  previewBuyerSchema,
  readCart,
  readPreviewBuyer,
  readPreviewDraft,
  storePreviewBuyer,
  type BrowserCartItem,
  type PreviewBuyer,
} from "@/modules/checkout/presentation/browser-checkout-session";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import {
  MissingCheckoutState,
  PreviewCheckoutUnavailable,
  TestModeBanner,
} from "@/ui/preview-checkout-shared";
import { useCheckoutSessionRevision } from "@/ui/use-checkout-session-revision";

export function PreviewBuyerForm({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const revision = useCheckoutSessionRevision();
  const cart: BrowserCartItem | null | undefined = revision === null ? undefined : readCart(window.sessionStorage);
  const buyer: PreviewBuyer | null | undefined = revision === null ? undefined : readPreviewBuyer(window.sessionStorage);
  const hasDraft = revision === null ? undefined : Boolean(readPreviewDraft(window.sessionStorage));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  if (!enabled) return <PreviewCheckoutUnavailable />;
  if (cart === undefined || buyer === undefined || hasDraft === undefined) {
    return <p className="checkout-loading" role="status">購入手続きを確認しています…</p>;
  }
  if (!cart || !hasDraft) {
    return <MissingCheckoutState message="カートから購入手続きを開始してください。" />;
  }

  function submitBuyer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = previewBuyerSchema.safeParse(Object.fromEntries(new FormData(event.currentTarget)));
    if (!parsed.success) {
      setFieldErrors(parsed.error.flatten().fieldErrors);
      return;
    }
    storePreviewBuyer(window.sessionStorage, parsed.data);
    router.push("/checkout/test/review");
  }

  return (
    <div className="checkout-form-shell">
      <TestModeBanner>
        入力内容はこのタブの中だけに一時保存され、テスト完了時またはタブを閉じた時に破棄されます。
      </TestModeBanner>
      <form className="checkout-form" onSubmit={submitBuyer} noValidate>
        <section className="checkout-form-section">
          <div className="form-intro">
            <div><p className="eyebrow">PURCHASER</p><h2>ご注文者</h2></div>
            <span><i aria-hidden="true">*</i> 必須項目</span>
          </div>
          <CheckoutField label="ご注文者のお名前" name="buyerName" error={fieldErrors.buyerName}>
            <input name="buyerName" id="buyerName" autoComplete="name" aria-describedby="buyerName-error" defaultValue={buyer?.buyerName} required />
          </CheckoutField>
          <CheckoutField label="メールアドレス" name="email" error={fieldErrors.email}>
            <input name="email" id="email" type="email" inputMode="email" autoComplete="email" aria-describedby="email-error" defaultValue={buyer?.email} required />
          </CheckoutField>
          <CheckoutField label="電話番号" name="phone" error={fieldErrors.phone}>
            <input name="phone" id="phone" type="tel" inputMode="tel" autoComplete="tel" aria-describedby="phone-error" placeholder="例：090-1234-5678" defaultValue={buyer?.phone} required />
          </CheckoutField>
        </section>
        <section className="checkout-form-section">
          <div className="form-intro">
            <div><p className="eyebrow">SHIPPING ADDRESS</p><h2>配送先</h2></div>
          </div>
          <CheckoutField label="郵便番号" name="postalCode" error={fieldErrors.postalCode}>
            <input name="postalCode" id="postalCode" inputMode="numeric" autoComplete="postal-code" aria-describedby="postalCode-error" placeholder="例：100-0001" defaultValue={buyer?.postalCode} required />
          </CheckoutField>
          <CheckoutField label="都道府県" name="prefecture" error={fieldErrors.prefecture}>
            <select name="prefecture" id="prefecture" autoComplete="address-level1" aria-describedby="prefecture-error" defaultValue={buyer?.prefecture ?? ""} required>
              <option value="" disabled>選択してください</option>
              {JAPAN_PREFECTURES.map((prefecture) => <option key={prefecture}>{prefecture}</option>)}
            </select>
          </CheckoutField>
          <CheckoutField label="市区町村" name="city" error={fieldErrors.city}>
            <input name="city" id="city" autoComplete="address-level2" aria-describedby="city-error" defaultValue={buyer?.city} required />
          </CheckoutField>
          <CheckoutField label="番地" name="addressLine1" error={fieldErrors.addressLine1}>
            <input name="addressLine1" id="addressLine1" autoComplete="address-line1" aria-describedby="addressLine1-error" defaultValue={buyer?.addressLine1} required />
          </CheckoutField>
          <CheckoutField label="建物名・部屋番号（任意）" name="addressLine2" error={fieldErrors.addressLine2} required={false}>
            <input name="addressLine2" id="addressLine2" autoComplete="address-line2" aria-describedby="addressLine2-error" defaultValue={buyer?.addressLine2} />
          </CheckoutField>
        </section>
        <button className="primary-button form-submit" type="submit">
          注文内容を確認する <span aria-hidden="true">→</span>
        </button>
      </form>
    </div>
  );
}

function CheckoutField({
  label,
  name,
  error,
  required = true,
  children,
}: {
  label: string;
  name: string;
  error?: readonly string[];
  required?: boolean;
  children: React.ReactNode;
}) {
  const errorId = `${name}-error`;
  return (
    <div className="form-field">
      <label htmlFor={name}>{label} {required ? <i aria-hidden="true">*</i> : null}</label>
      {children}
      <p className="field-error" id={errorId} role={error?.length ? "alert" : undefined}>
        {error?.[0] ?? ""}
      </p>
    </div>
  );
}
