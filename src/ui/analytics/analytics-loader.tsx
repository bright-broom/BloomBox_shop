"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { isAnalyticsExcludedPath } from "@/shared/domain/analytics-policy";
import { useAnalyticsConsent } from "./use-analytics-consent";
import { observeSections, pauseAnalytics, startAnalytics, stopAnalytics, trackPageView } from "@/shared/infrastructure/analytics/ga4-browser";

/** Loads GA4 only after consent and only outside excluded screens; renders nothing. */
export function AnalyticsLoader({ measurementId, scriptUrl }: { measurementId: string; scriptUrl: string }) {
  const pathname = usePathname() ?? "/";
  const consent = useAnalyticsConsent();

  useEffect(() => {
    if (consent === "denied") {
      stopAnalytics();
      return;
    }
    if (consent !== "granted") return;
    if (isAnalyticsExcludedPath(pathname)) {
      pauseAnalytics(true);
      return;
    }
    startAnalytics(measurementId, scriptUrl);
    trackPageView(pathname);
    return observeSections(pathname);
  }, [consent, pathname, measurementId, scriptUrl]);

  return null;
}
