"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { REFERRAL_CODE_LENGTH, type ReferralSnapshot } from "@/modules/referral/public";
import { readReferralAction, updateReferralAction } from "@/modules/referral/presentation/actions";
import { referralContent as copy, referralCopy } from "@/shared/infrastructure/content/referral-content";

export function ReferralPanel({ initialCode }: { initialCode: string }) {
  const [snapshot, setSnapshot] = useState<ReferralSnapshot | null>();
  const [code, setCode] = useState(initialCode);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  useEffect(() => {
    let active = true;
    readReferralAction().then((result) => {
      if (active) { setSnapshot(result.snapshot); setError(result.error); }
    }).catch(() => { if (active) { setSnapshot(null); setError(copy.loadError); } });
    return () => { active = false; };
  }, []);

  const link = snapshot ? new URL(`/referrals?code=${snapshot.inviteCode}`, window.location.origin).toString() : "";

  async function update(operation: "enroll" | "join" | "new_test_member" | "switch_test_member") {
    setPending(true); setError(undefined); setNotice(undefined);
    try {
      const result = await updateReferralAction({ operation, code });
      if (result.snapshot) setSnapshot(result.snapshot);
      setError(result.error);
    } catch { setError(copy.loadError); }
    finally { setPending(false); }
  }

  async function refresh() {
    setPending(true);
    try { const result = await readReferralAction(); setSnapshot(result.snapshot); setError(result.error); }
    catch { setError(copy.loadError); }
    finally { setPending(false); }
  }

  async function copyLink() {
    try { await navigator.clipboard.writeText(link); setNotice(copy.copyDone); }
    catch { setNotice(copy.copyFailed); }
  }

  const statuses = { AVAILABLE: copy.statusAvailable, USED: copy.statusUsed, REVOKED: copy.statusRevoked, EXPIRED: copy.statusExpired };
  return (
    <div className="referral-panel" aria-busy={pending}>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      {snapshot === undefined ? <p role="status">{copy.working}</p> : null}
      {snapshot === null ? <button className="primary-button" disabled={pending} onClick={() => update("enroll")}>{copy.create}</button> : null}
      {snapshot ? <>
        <div className="form-field">
          <label htmlFor="referral-link">{copy.linkLabel}</label>
          <input id="referral-link" value={link} readOnly onFocus={(event) => event.target.select()} />
          <button className="secondary-button" type="button" onClick={copyLink} disabled={!link}>{copy.copy}</button>
        </div>
        <section className="referral-account">
          <h2>{copy.overviewTitle}</h2>
          <dl className="checkout-details"><div><dt>{copy.pending}</dt><dd>{snapshot.pendingCount}</dd></div><div><dt>{copy.rewarded}</dt><dd>{snapshot.rewardedCount}</dd></div></dl>
          <h3>{copy.coupons}</h3>
          {snapshot.coupons.length === 0 ? <p>{copy.noCoupons}</p> : <ul className="referral-coupons">{snapshot.coupons.map((coupon) => <li key={coupon.id}>
            <strong>{coupon.kind === "WELCOME" ? copy.welcome : copy.thanks}</strong>
            <span>{statuses[coupon.status]}</span>
            <span>{copy.expires}：{new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo" }).format(new Date(coupon.expiresAt))}</span>
          </li>)}</ul>}
          {snapshot.reviewCount ? <p role="status">{copy.reviewNotice}</p> : null}
          <button className="text-link" disabled={pending} onClick={refresh}>{copy.refresh}</button>
        </section>
      </> : null}
      <form className="referral-claim" onSubmit={(event) => { event.preventDefault(); void update("join"); }}>
        <h2>{referralCopy(copy.friendBenefit)}</h2>
        {snapshot?.joined ? <p role="status">{copy.joined}</p> : <>
          <div className="form-field"><label htmlFor="referral-code">{copy.codeLabel}</label>
            <input id="referral-code" autoCapitalize="characters" autoComplete="off" spellCheck={false} value={code} onChange={(event) => setCode(event.target.value)} required maxLength={REFERRAL_CODE_LENGTH} />
          </div>
          <button className="primary-button" disabled={pending || snapshot === undefined}>{pending ? copy.working : copy.join}</button>
        </>}
      </form>
      <Link className="primary-button" href="/flowers">{copy.browse}<span aria-hidden="true">→</span></Link>
      {snapshot ? <details className="referral-simulation">
        <summary>{copy.simulateTitle}</summary><p>{copy.simulationNote}</p>
        <div className="referral-actions">
          <button className="secondary-button" disabled={pending} onClick={() => update("new_test_member")}>{copy.newMember}</button>
          <button className="secondary-button" disabled={pending} onClick={() => update("switch_test_member")}>{copy.swapMember}</button>
        </div>
      </details> : null}
    </div>
  );
}
