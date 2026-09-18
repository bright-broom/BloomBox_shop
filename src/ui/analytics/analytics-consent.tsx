"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ANALYTICS_CONSENT_EVENT,
  analyticsConsentCookie,
  isAnalyticsExcludedPath,
} from "@/shared/domain/analytics-policy";
import { analyticsContent as copy } from "@/shared/infrastructure/content/analytics-content";
import { useAnalyticsConsent } from "./use-analytics-consent";

/** Asks for analytics consent outside excluded screens; the settings button stays available on customer pages. */
export function AnalyticsConsentPanel() {
  const pathname = usePathname() ?? "/";
  const consent = useAnalyticsConsent();
  const [open, setOpen] = useState(false);
  const settings = useRef<HTMLButtonElement>(null);

  if (pathname === "/operations" || pathname.startsWith("/operations/")) return null;

  function save(choice: "granted" | "denied") {
    document.cookie = analyticsConsentCookie(choice, window.location.protocol === "https:");
    setOpen(false);
    window.dispatchEvent(new Event(ANALYTICS_CONSENT_EVENT));
    settings.current?.focus();
  }

  const asking = open || (consent === "unknown" && !isAnalyticsExcludedPath(pathname));
  return <div className="analytics-settings">
    <button className="text-button" ref={settings} type="button" aria-expanded={asking} aria-controls="analytics-consent" onClick={() => setOpen(true)}>
      {copy.settings}
    </button>
    {asking ? <section id="analytics-consent" className="advertising-consent" aria-labelledby="analytics-consent-title">
      <h2 id="analytics-consent-title">{copy.title}</h2>
      <p>{copy.body}</p>
      <p>{copy.note} <Link href="/privacy">{copy.privacy}</Link></p>
      <div className="advertising-consent-actions">
        <button type="button" className="secondary-button" onClick={() => save("denied")}>{copy.reject}</button>
        <button type="button" className="secondary-button" onClick={() => save("granted")}>{copy.accept}</button>
        {consent !== "unknown" ? <button type="button" className="text-button" onClick={() => { setOpen(false); settings.current?.focus(); }}>{copy.close}</button> : null}
      </div>
    </section> : null}
  </div>;
}
