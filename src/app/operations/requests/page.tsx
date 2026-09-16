import { ACCOUNT_LIMITS } from "@/modules/customer/public";
import type { Metadata } from "next";
import Link from "next/link";
import { requireOperatorLogin } from "@/shared/infrastructure/security/auth-entry";
import { openCustomerRequests } from "@/shared/infrastructure/security/operator-auth/customer-requests";
import { customerPortalContent as copy } from "@/shared/infrastructure/content/customer-portal-content";
import { PortalForm } from "@/ui/account-portal-form";
import { replyToCustomer } from "./actions";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: copy.requestQueue,
  robots: { index: false, follow: false },
};
export default async function Requests({
  searchParams,
}: {
  searchParams: Promise<{ closed?: string }>;
}) {
  await requireOperatorLogin("/operations/requests");
  const closed = (await searchParams).closed === "1";
  let result;
  try {
    result = await openCustomerRequests(closed);
  } catch {
    console.error("operator_requests_unavailable");
    return <p role="alert">{copy.unavailable}</p>;
  }
  return (
    <>
      <h1>{copy.requestQueue}</h1>
      <p>{copy.requestQueueNote}</p>
      <nav className="account-order-actions">
        <Link href="/operations/requests">{copy.statuses.OPEN}</Link>
        <Link href="/operations/requests?closed=1">{copy.statuses.CLOSED}</Link>
      </nav>
      <div className="account-address-grid">
        {result.requests.length ? (
          result.requests.map((request) => (
            <section key={request.id} className="account-panel">
              <h2>{copy.kinds[request.kind]}</h2>
              <p>{copy.statuses[request.status]}</p>
              <code>{request.id}</code>
              <p className="account-prewrap">{request.message}</p>
              <Link
                className="text-link"
                href={"/operations/customers/" + request.customerId}
              >
                {copy.profile}
              </Link>
              <PortalForm action={replyToCustomer} label={copy.replySave}>
                <input type="hidden" name="id" value={request.id} />
                <input type="hidden" name="revision" value={request.revision} />
                <label>
                  {copy.reply}
                  <textarea
                    name="reply"
                    defaultValue={request.reply}
                    rows={5}
                    maxLength={ACCOUNT_LIMITS.message}
                    required
                  />
                </label>
                <label>
                  {copy.requests}
                  <select name="status" defaultValue="REPLIED">
                    <option value="REPLIED">{copy.statuses.REPLIED}</option>
                    <option value="CLOSED">{copy.statuses.CLOSED}</option>
                  </select>
                </label>
              </PortalForm>
            </section>
          ))
        ) : (
          <p>{copy.noRequests}</p>
        )}
      </div>
      <section className="account-panel">
        <h2>{copy.privacyQueue}</h2>
        <p>{copy.privacyQueueNote}</p>
        {result.privacy.map((request) => (
          <p className="account-wrap" key={request.id}>
            {request.requested_at.toLocaleDateString("ja-JP", {
              timeZone: "Asia/Tokyo",
            })}{" "}
            · {request.request_type} · {request.id}
          </p>
        ))}
      </section>
    </>
  );
}
