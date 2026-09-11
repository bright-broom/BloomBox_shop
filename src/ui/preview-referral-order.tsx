"use client";

import { useState } from "react";
import Link from "next/link";
import { simulateReferralOrderAction } from "@/modules/checkout/presentation/preview-referral-actions";
import { referralContent as copy } from "@/shared/infrastructure/content/referral-content";

export function PreviewReferralOrder({ requestId, tracked }: { requestId?: string; tracked: boolean }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  async function simulate(operation: "delivered" | "refunded") {
    setPending(true); setError(undefined); setNotice(undefined);
    try {
      const result = await simulateReferralOrderAction({ requestId, operation });
      setError(result.error);
      if (result.success) setNotice(copy.eventDone);
    } catch { setError(copy.loadError); }
    finally { setPending(false); }
  }
  return <section className="referral-after-checkout">
    <h2>{copy.afterCheckoutTitle}</h2>
    {tracked && requestId ? <div className="referral-actions">
      <button className="secondary-button" disabled={pending} onClick={() => simulate("delivered")}>{copy.deliverAction}</button>
      <button className="secondary-button" disabled={pending} onClick={() => simulate("refunded")}>{copy.refundAction}</button>
    </div> : null}
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    {notice ? <p role="status">{notice}</p> : null}
    <Link className="text-link" href="/referrals">{copy.showReferrals}</Link>
  </section>;
}
