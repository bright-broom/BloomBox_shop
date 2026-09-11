import Link from "next/link";
import type { PermissionManagementPage, PermissionManagementState } from "@/modules/fulfillment/public";
import { operatorPermissionsContent as copy } from "@/shared/infrastructure/content/operator-permissions-content";
import { PermissionRevocationForm } from "./permission-revocation-form";

const date = (value: string) => new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tokyo" }).format(new Date(value));
export function OperatorPermissions({ page, action }: { page: PermissionManagementPage;
  action: (previous: PermissionManagementState, form: FormData) => Promise<PermissionManagementState> }) {
  const path = `/operations/permissions?${new URLSearchParams({ shop: page.shop })}`;
  return <>
    <h2>{page.shop}</h2><p>{copy.registrationHint}</p>
    {page.entries.length === 0 ? <p>{copy.empty}</p> : <div className="permission-management-list">
      {page.entries.map((entry) => <section className="permission-card" key={entry.id} aria-label={`${copy.registration} ${entry.operatorId}`}>
        <dl><div><dt>{copy.registration}</dt><dd>{entry.operatorId}</dd></div>
          <div><dt>{copy.status}</dt><dd>{!entry.enabled ? copy.disabled : entry.validUntil <= page.viewedAt ? copy.expired : copy.active}</dd></div>
          <div><dt>{copy.validUntil}</dt><dd>{date(entry.validUntil)}</dd></div>
          <div><dt>{copy.version}</dt><dd>{entry.version}</dd></div></dl>
        {entry.latestRevocation ? <div className="permission-history"><h3>{copy.history}</h3>
          <p>{date(entry.latestRevocation.revokedAt)} · {copy.reasons[entry.latestRevocation.reason]} · {copy.version} {entry.latestRevocation.version}</p>
          <p>{copy.revokedBy}: {entry.latestRevocation.operatorId}</p></div> : null}
        {entry.intent ? <PermissionRevocationForm intent={entry.intent} action={action} /> : null}
      </section>)}
    </div>}
    <nav className="fulfillment-scenarios" aria-label={copy.title}>
      <a className="text-link" href={path}>{copy.refresh}</a>
      {page.nextCursor ? <Link className="text-link" prefetch={false} href={`${path}&${new URLSearchParams({ cursor: page.nextCursor })}`}>{copy.next}</Link> : null}
      <Link className="text-link" prefetch={false} href={path}>{copy.first}</Link>
    </nav>
  </>;
}
