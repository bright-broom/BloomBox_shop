"use client";
import { customerPortalContent as copy } from "@/shared/infrastructure/content/customer-portal-content";
export default function AccountError({ reset }: { reset: () => void }) {
  return (
    <section className="section-shell account-page">
      <p role="alert">{copy.unavailable}</p>
      <button type="button" className="primary-button" onClick={reset}>
        {copy.retry}
      </button>
    </section>
  );
}
