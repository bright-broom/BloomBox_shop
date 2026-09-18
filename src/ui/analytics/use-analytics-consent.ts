"use client";
import { useSyncExternalStore } from "react";
import { ANALYTICS_CONSENT_EVENT, readAnalyticsConsent, type AnalyticsConsent } from "@/shared/domain/analytics-policy";

function subscribe(onChange: () => void) {
  window.addEventListener(ANALYTICS_CONSENT_EVENT, onChange);
  return () => window.removeEventListener(ANALYTICS_CONSENT_EVENT, onChange);
}

/** The visitor's analytics choice from the first-party cookie; null while server rendering. */
export function useAnalyticsConsent(): AnalyticsConsent | null {
  return useSyncExternalStore(subscribe, () => readAnalyticsConsent(document.cookie), () => null);
}
