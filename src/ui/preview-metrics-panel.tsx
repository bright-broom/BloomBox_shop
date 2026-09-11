"use client";
import { giftExperienceContent } from "@/shared/infrastructure/content/gift-experience-content";
import { useState, useSyncExternalStore } from "react";
import { z } from "zod";
import { readPreviewMetrics, setPreviewMetricsEnabled, previewMetricSchema, PREVIEW_METRICS_CHANGED } from "@/shared/infrastructure/preview-metrics";

function subscribe(listener: () => void) { window.addEventListener(PREVIEW_METRICS_CHANGED, listener); return () => window.removeEventListener(PREVIEW_METRICS_CHANGED, listener); }
function getSnapshot() { try { return JSON.stringify(readPreviewMetrics(window.sessionStorage)); } catch { return "error"; } }

export function PreviewMetricsPanel() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, () => "null");
  const events = snapshot === "error" || snapshot === "null" ? null : z.array(previewMetricSchema).parse(JSON.parse(snapshot));
  const [error, setError] = useState(false);
  function refresh() {
    window.dispatchEvent(new Event(PREVIEW_METRICS_CHANGED));
  }
  function toggle() {
    try { setPreviewMetricsEnabled(window.sessionStorage, events === null); setError(false); refresh(); }
    catch { setError(true); }
  }
  const copy = giftExperienceContent.metrics;
  const labels = copy.labels;
  return <section className="referral-account">
    <h2>{copy.title}</h2>
    <p>{copy.notice}</p>
    <div className="referral-actions"><button className="secondary-button" onClick={toggle}>{events === null ? copy.start : copy.stop}</button><button className="text-link" onClick={refresh}>{copy.refresh}</button></div>
    {error || snapshot === "error" ? <p role="alert">{copy.error}</p> : null}
    {events ? <dl className="checkout-details">{Object.entries(labels).map(([name, label]) => <div key={name}><dt>{label}</dt><dd>{events.filter((event) => event.name === name).length}</dd></div>)}<div><dt>{copy.referral}</dt><dd>{events.filter((event) => event.name === "preview_purchase" && event.referralUsed).length}</dd></div></dl> : null}
  </section>;
}
