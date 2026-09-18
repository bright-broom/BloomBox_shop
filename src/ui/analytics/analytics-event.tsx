"use client";
import { useEffect } from "react";
import Link from "next/link";
import { purchaseAnalytics, type PurchaseAnalyticsInput } from "@/shared/domain/analytics-policy";
import { trackAnalyticsEvent, trackPurchaseOnce } from "@/shared/infrastructure/analytics/ga4-browser";

type Params = Readonly<Record<string, string | number | boolean | ReadonlyArray<Readonly<Record<string, string | number>>>>>;

/** Reports one event after the page renders; renders nothing. */
export function AnalyticsEvent({ name, params }: { name: string; params: Params }) {
  const key = JSON.stringify([name, params]);
  useEffect(() => {
    const [eventName, eventParams] = JSON.parse(key) as [string, Params];
    trackAnalyticsEvent(eventName, eventParams);
  }, [key]);
  return null;
}

/** Reports a confirmed purchase once per tab, with the first or repeat purchase type. */
export function AnalyticsPurchase({ order }: { order: PurchaseAnalyticsInput }) {
  const key = JSON.stringify(order);
  useEffect(() => {
    const input = JSON.parse(key) as PurchaseAnalyticsInput;
    const event = purchaseAnalytics(input);
    trackPurchaseOnce(input.transactionId, event.params, event.userProperties);
  }, [key]);
  return null;
}

/** A link that reports an event when followed, for steps that lead into excluded screens. */
export function AnalyticsLink({ event, params, ...props }: React.ComponentProps<typeof Link> & { event: string; params: Params }) {
  return <Link {...props} onClick={(clickEvent) => {
    trackAnalyticsEvent(event, params);
    props.onClick?.(clickEvent);
  }} />;
}
