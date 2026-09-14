import Link from "next/link";
import { LOYALTY_TIERS } from "@/modules/customer/public";
import type { CustomerLoyaltyState } from "@/shared/infrastructure/customer-loyalty";
import { customerAccountContent } from "@/shared/infrastructure/content/customer-account-content";
import { formatMoney, money } from "@/shared/domain/money";
const copy = customerAccountContent.loyalty;
export function CustomerLoyaltyPanel({ state }: { state: CustomerLoyaltyState }) {
  if (state.status !== "ready") return <section id="account-loyalty" className="account-loyalty">
    <h2>{copy.title}</h2><p role="status">{copy.unavailable}</p><Link className="text-link" prefetch={false} href="/account">{customerAccountContent.retry}</Link>
  </section>;
  const { progress } = state;
  return <section id="account-loyalty" className="account-loyalty" aria-labelledby="loyalty-title">
    <header><p className="eyebrow">{copy.eyebrow}</p><h2 id="loyalty-title">{copy.title}</h2><p>{copy.lead}</p></header>
    <div className="loyalty-card">
      <div className="loyalty-current"><div><p>{copy.currentRank}</p><h3>{progress.tier.id}</h3></div>
        <div className="loyalty-rate"><strong>{progress.tier.basisPoints / 100}<span>%</span></strong><p>{copy.discount}</p></div></div>
      <p>{copy.spend} <strong>{formatMoney(money(progress.eligibleSpendYen))}</strong></p>
      {progress.nextTier ? <p id="loyalty-progress-label">{progress.nextTier.id} {copy.untilNext} <strong>{formatMoney(money(progress.remainingYen))}</strong></p>
        : <p id="loyalty-progress-label">{copy.topRank}</p>}
      <progress max={100} value={progress.progressPercent} aria-labelledby="loyalty-progress-label">{progress.progressPercent}%</progress>
      <p className="loyalty-card-note">{copy.timing}</p>
    </div>
    <ol className="loyalty-tiers" aria-label={copy.rankList}>{LOYALTY_TIERS.map((tier) => <li key={tier.id} aria-current={tier.id === progress.tier.id ? "step" : undefined}>
      <strong>{tier.id}</strong><span>{formatMoney(money(tier.thresholdYen))}{copy.from}</span><span>{tier.basisPoints / 100}% {copy.off}</span>
      {tier.id === progress.tier.id ? <small>{copy.currentRank}</small> : null}
    </li>)}</ol>
    <details className="loyalty-terms"><summary>{copy.conditions}</summary><ul>{copy.rules.map((rule) => <li key={rule}>{rule}</li>)}</ul></details>
    <p className="form-hint">{copy.pilot}</p>
  </section>;
}
