import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { loadOperatorEntry } from "@/shared/infrastructure/security/auth-entry";
import { operationsConsoleSettings } from "@/shared/infrastructure/config/operations-console-config";
import { operationsConsoleContent as copy } from "@/shared/infrastructure/content/operations-console-content";
import { ConsoleHeader } from "@/ui/operations-console";
import { OperationsIcon } from "@/ui/operations-icon";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: copy.settings,
  robots: { index: false, follow: false },
};
export default async function Settings() {
  const identity = await loadOperatorEntry();
  if (identity.status !== "ready") redirect("/operations/login");
  const settings = operationsConsoleSettings();
  return (
    <>
      <ConsoleHeader title={copy.settings} lead={copy.settingsLead} />
      <div className="ops-settings-grid">
        <section className="ops-panel">
          <h2>
            <OperationsIcon name="lock" />
            {copy.identity}
          </h2>
          <p className="ops-badge">{copy.verified}</p>
          <p>{identity.bound ? copy.bound : copy.unboundNote}</p>
          {!identity.bound ? (
            <details>
              <summary>{copy.registration}</summary>
              <p>{copy.registrationNote}</p>
              <code className="ops-private-reference">{identity.subject}</code>
            </details>
          ) : null}
        </section>
        <section className="ops-panel">
          <h2>{copy.connections}</h2>
          <p className="ops-badge">{copy[settings.mode]}</p>
          <dl className="ops-connection-list">
            {Object.entries(settings.connections).map(([key, state]) => (
              <div key={key}>
                <dt>
                  {
                    copy.connectionNames[
                      key as keyof typeof copy.connectionNames
                    ]
                  }
                </dt>
                <dd>{copy[state]}</dd>
              </div>
            ))}
          </dl>
          <p className="ops-caption">{copy.configuredNote}</p>
        </section>
        <section className="ops-panel">
          <h2>{copy.security}</h2>
          <p>{copy.securityNote}</p>
          <p className="ops-caption">{copy.retentionNote}</p>
        </section>
        <section className="ops-panel">
          <h2>{copy.marketing}</h2>
          <p className="ops-badge">{copy[settings.advertising]}</p>
          <p>{copy.marketingNote}</p>
        </section>
        <section className="ops-panel">
          <h2>{copy.loyalty}</h2>
          <p>{copy.loyaltyNote}</p>
          <Link className="text-link" href="/operations/customers" prefetch={false}>
            {copy.customers}
            <OperationsIcon name="arrow" />
          </Link>
        </section>
        <section className="ops-panel">
          <h2>{copy.support}</h2>
          <p>{copy.shippingNote}</p>
          <Link className="text-link" href="/shipping-returns">
            {copy.returns}
          </Link>
          <Link className="text-link" href="/privacy">
            {copy.privacy}
          </Link>
        </section>
      </div>
    </>
  );
}
