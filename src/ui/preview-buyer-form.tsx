"use client";

import {
  previewBuyerSchema,
  readCart,
  readPreviewBuyer,
  readPreviewDraft,
  storePreviewBuyer,
  type BrowserCartItem,
  type PreviewBuyer,
} from "@/modules/checkout/presentation/browser-checkout-session";
import {
  formatPostalCode,
  isValidPostalCode,
  JAPAN_PREFECTURES,
  normalizePostalCode,
  POSTAL_CODE_DIGITS,
  postalCodeLookupResponseSchema,
  type PostalAddress,
} from "@/modules/fulfillment/public";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import {
  MissingCheckoutState,
  PreviewCheckoutUnavailable,
  TestModeBanner,
} from "@/ui/preview-checkout-shared";
import { useCheckoutSessionRevision } from "@/ui/use-checkout-session-revision";

export function PreviewBuyerForm({ enabled }: { enabled: boolean }) {
  const revision = useCheckoutSessionRevision();
  const cart: BrowserCartItem | null | undefined = revision === null ? undefined : readCart(window.sessionStorage);
  const buyer: PreviewBuyer | null | undefined = revision === null ? undefined : readPreviewBuyer(window.sessionStorage);
  const hasDraft = revision === null ? undefined : Boolean(readPreviewDraft(window.sessionStorage));

  if (!enabled) return <PreviewCheckoutUnavailable />;
  if (cart === undefined || buyer === undefined || hasDraft === undefined) {
    return <p className="checkout-loading" role="status">購入手続きを確認しています…</p>;
  }
  if (!cart || !hasDraft) {
    return <MissingCheckoutState message="カートから購入手続きを開始してください。" />;
  }

  return <BuyerDetailsForm initialBuyer={buyer} />;
}

type LookupStatus = Readonly<{
  state: "idle" | "loading" | "success" | "error";
  message: string;
}>;

function BuyerDetailsForm({ initialBuyer }: { initialBuyer: PreviewBuyer | null }) {
  const router = useRouter();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [postalCode, setPostalCode] = useState(initialBuyer?.postalCode ?? "");
  const [prefecture, setPrefecture] = useState(initialBuyer?.prefecture ?? "");
  const [city, setCity] = useState(initialBuyer?.city ?? "");
  const [addressLine1, setAddressLine1] = useState(initialBuyer?.addressLine1 ?? "");
  const [candidates, setCandidates] = useState<readonly PostalAddress[]>([]);
  const [selectedCandidate, setSelectedCandidate] = useState("0");
  const [lookupStatus, setLookupStatus] = useState<LookupStatus>({ state: "idle", message: "" });
  const initialPostalCode = initialBuyer?.postalCode ?? "";
  const lastLookupRef = useRef<string | undefined>(
    isValidPostalCode(initialPostalCode) ? normalizePostalCode(initialPostalCode) : undefined,
  );
  const notFoundPostalCodeRef = useRef<string | undefined>(undefined);
  const requestControllerRef = useRef<AbortController | undefined>(undefined);

  const applyCandidate = useCallback((address: PostalAddress, index: number) => {
    setPrefecture(address.prefecture);
    setCity(address.city);
    setAddressLine1(address.town);
    setSelectedCandidate(String(index));
  }, []);

  const lookupAddress = useCallback(async (input: string, force = false) => {
    if (!isValidPostalCode(input)) {
      setFieldErrors((current) => ({
        ...current,
        postalCode: [`郵便番号は ${POSTAL_CODE_DIGITS} 桁の数字で入力してください。`],
      }));
      setLookupStatus({ state: "error", message: "郵便番号を確認してください。" });
      return;
    }

    const normalized = normalizePostalCode(input);
    if (!force && lastLookupRef.current === normalized) return;
    lastLookupRef.current = normalized;
    requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;
    setLookupStatus({ state: "loading", message: "住所を検索しています…" });
    setFieldErrors((current) => {
      const next = { ...current };
      delete next.postalCode;
      return next;
    });

    try {
      const response = await fetch("/api/postal-code", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ postalCode: normalized }),
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      });
      const parsed = postalCodeLookupResponseSchema.safeParse(await response.json());
      if (!parsed.success) throw new Error("Invalid postal code lookup response");
      if (!parsed.data.ok) {
        const lookupError = parsed.data;
        setCandidates([]);
        notFoundPostalCodeRef.current = lookupError.code === "not_found" ? normalized : undefined;
        setLookupStatus({ state: "error", message: lookupError.message });
        return;
      }

      notFoundPostalCodeRef.current = undefined;
      setPostalCode(parsed.data.postalCode);
      setCandidates(parsed.data.addresses);
      applyCandidate(parsed.data.addresses[0], 0);
      setLookupStatus({
        state: "success",
        message: parsed.data.addresses.length > 1
          ? "住所候補が複数あります。正しい町域を選択し、番地を入力してください。"
          : "住所を自動入力しました。町名・番地を確認してください。",
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      notFoundPostalCodeRef.current = undefined;
      setCandidates([]);
      setLookupStatus({
        state: "error",
        message: "住所の自動入力を利用できません。住所を手入力してください。",
      });
    }
  }, [applyCandidate]);

  useEffect(() => {
    if (!isValidPostalCode(postalCode)) return;
    const timeoutId = window.setTimeout(() => void lookupAddress(postalCode), 450);
    return () => window.clearTimeout(timeoutId);
  }, [lookupAddress, postalCode]);

  useEffect(() => () => requestControllerRef.current?.abort(), []);

  function changePostalCode(event: ChangeEvent<HTMLInputElement>) {
    setPostalCode(event.target.value);
    setCandidates([]);
    setLookupStatus({ state: "idle", message: "" });
    notFoundPostalCodeRef.current = undefined;
    if (!isValidPostalCode(event.target.value)) lastLookupRef.current = undefined;
  }

  function changeCandidate(event: ChangeEvent<HTMLSelectElement>) {
    const index = Number(event.target.value);
    const candidate = candidates[index];
    if (candidate) applyCandidate(candidate, index);
  }

  function submitBuyer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      isValidPostalCode(postalCode)
      && notFoundPostalCodeRef.current === normalizePostalCode(postalCode)
    ) {
      setFieldErrors((current) => ({
        ...current,
        postalCode: ["郵便番号に一致する住所が見つかりません。入力内容をご確認ください。"],
      }));
      return;
    }
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
            <input name="buyerName" id="buyerName" autoComplete="name" aria-describedby="buyerName-error" defaultValue={initialBuyer?.buyerName} required />
          </CheckoutField>
          <CheckoutField label="メールアドレス" name="email" error={fieldErrors.email}>
            <input name="email" id="email" type="email" inputMode="email" autoComplete="email" aria-describedby="email-error" defaultValue={initialBuyer?.email} required />
          </CheckoutField>
          <CheckoutField label="電話番号" name="phone" error={fieldErrors.phone}>
            <input name="phone" id="phone" type="tel" inputMode="tel" autoComplete="tel" aria-describedby="phone-error" placeholder="例：090-1234-5678" defaultValue={initialBuyer?.phone} required />
          </CheckoutField>
        </section>
        <section className="checkout-form-section">
          <div className="form-intro">
            <div><p className="eyebrow">SHIPPING ADDRESS</p><h2>配送先</h2></div>
          </div>
          <CheckoutField label="郵便番号" name="postalCode" error={fieldErrors.postalCode}>
            <div className="postal-code-controls">
              <input
                name="postalCode"
                id="postalCode"
                inputMode="numeric"
                autoComplete="postal-code"
                aria-describedby="postalCode-note postalCode-lookup-status postalCode-error"
                placeholder="例：100-0001"
                value={postalCode}
                onChange={changePostalCode}
                onBlur={() => {
                  if (isValidPostalCode(postalCode)) setPostalCode(formatPostalCode(postalCode));
                }}
                required
              />
              <button
                className="secondary-button postal-code-button"
                type="button"
                disabled={lookupStatus.state === "loading"}
                onClick={() => void lookupAddress(postalCode, true)}
              >
                {lookupStatus.state === "loading" ? "検索中…" : "住所を検索"}
              </button>
            </div>
            <p className="field-note" id="postalCode-note">
              ハイフンの有無や全角・半角を問わず、{POSTAL_CODE_DIGITS} 桁を入力すると住所を検索します。
            </p>
            <p
              className={`postal-code-status is-${lookupStatus.state}`}
              id="postalCode-lookup-status"
              role={lookupStatus.state === "error" ? "alert" : "status"}
              aria-live={lookupStatus.state === "error" ? "assertive" : "polite"}
            >
              {lookupStatus.message}
            </p>
          </CheckoutField>
          {candidates.length > 1 ? (
            <CheckoutField label="住所候補" name="postalAddressCandidate" required={false}>
              <select id="postalAddressCandidate" value={selectedCandidate} onChange={changeCandidate}>
                {candidates.map((candidate, index) => (
                  <option key={`${candidate.prefecture}-${candidate.city}-${candidate.town}`} value={index}>
                    {candidate.prefecture}{candidate.city}{candidate.town}
                  </option>
                ))}
              </select>
            </CheckoutField>
          ) : null}
          <CheckoutField label="都道府県" name="prefecture" error={fieldErrors.prefecture}>
            <select name="prefecture" id="prefecture" autoComplete="address-level1" aria-describedby="prefecture-error" value={prefecture} onChange={(event) => setPrefecture(event.target.value)} required>
              <option value="" disabled>選択してください</option>
              {JAPAN_PREFECTURES.map((item) => <option key={item}>{item}</option>)}
            </select>
          </CheckoutField>
          <CheckoutField label="市区町村" name="city" error={fieldErrors.city}>
            <input name="city" id="city" autoComplete="address-level2" aria-describedby="city-error" value={city} onChange={(event) => setCity(event.target.value)} required />
          </CheckoutField>
          <CheckoutField label="町名・番地" name="addressLine1" error={fieldErrors.addressLine1}>
            <input name="addressLine1" id="addressLine1" autoComplete="address-line1" aria-describedby="addressLine1-error" value={addressLine1} onChange={(event) => setAddressLine1(event.target.value)} required />
          </CheckoutField>
          <CheckoutField label="建物名・部屋番号（任意）" name="addressLine2" error={fieldErrors.addressLine2} required={false}>
            <input name="addressLine2" id="addressLine2" autoComplete="address-line2" aria-describedby="addressLine2-error" defaultValue={initialBuyer?.addressLine2} />
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
