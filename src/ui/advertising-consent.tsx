"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { advertisingContent as copy } from "@/shared/infrastructure/content/advertising-content";
function currentClicks() {
  const clicks: Record<string, string> = {};
  if (!/^\/(?:flowers(?:\/[^/]+)?|gift\/[^/]+)?$/.test(window.location.pathname)) return clicks;
  const params = new URLSearchParams(window.location.search);
  for (const key of ["gclid", "gbraid", "wbraid", "fbclid"]) {
    const value = params.get(key); if (value && /^[A-Za-z0-9_.~-]{1,512}$/.test(value)) clicks[key] = value;
  }
  return clicks;
}
type Choice = "unknown" | "granted" | "denied";
export function AdvertisingConsent({ preview }: { preview: boolean }) {
  const [choice, setChoice] = useState<Choice>(); const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false); const [error, setError] = useState(false);
  const settings = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try { const response = await fetch("/api/advertising/consent", { cache: "no-store" });
        const data: { enabled?: boolean; choice?: unknown } = await response.json();
        if (active && response.ok && data.enabled && ["unknown", "granted", "denied"].includes(String(data.choice))) {
          setChoice(data.choice as Choice);
          // Capture a later advertising landing only after the server confirms prior consent.
          const clicks = preview ? {} : currentClicks();
          if (data.choice === "granted" && Object.keys(clicks).length) {
            const capture = await fetch("/api/advertising/consent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ choice: "capture", ...clicks }) });
            if (!capture.ok && active) setError(true);
          }
        }
      } catch { if (active) setError(true); }
    };
    void refresh(); window.addEventListener("focus", refresh);
    return () => { active = false; window.removeEventListener("focus", refresh); };
  }, [preview]);
  async function save(next: "granted" | "denied") {
    setPending(true); setError(false);
    try {
      // Read only allowlisted click IDs after explicit consent; never URLs or form fields.
      const clicks = next === "granted" && !preview ? currentClicks() : {};
      const response = await fetch("/api/advertising/consent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ choice: next, ...clicks }) });
      if (!response.ok) throw new Error();
      setChoice(next); setOpen(false); if (open) settings.current?.focus();
    } catch { setError(true); } finally { setPending(false); }
  }
  return <div className="advertising-settings">
    <button className="text-button" ref={settings} type="button" aria-expanded={open || choice === "unknown"} aria-controls="advertising-consent" onClick={() => setOpen(true)}>{copy.settings}</button>
    {open || choice === "unknown" ? <section id="advertising-consent" className="advertising-consent" aria-labelledby="advertising-consent-title">
      <h2 id="advertising-consent-title">{copy.title}</h2>
      <p>{preview ? copy.preview : copy.body}</p><p>{copy.note} <Link href="/privacy">{copy.privacy}</Link></p>
      {error ? <p role="alert">{copy.error}</p> : null}
      <div className="advertising-consent-actions">
        <button type="button" className="secondary-button" disabled={pending} onClick={() => void save("denied")}>{pending ? copy.saving : copy.reject}</button>
        <button type="button" className="secondary-button" disabled={pending} onClick={() => void save("granted")}>{pending ? copy.saving : copy.accept}</button>
        {choice !== "unknown" ? <button type="button" className="text-button" disabled={pending} onClick={() => { setOpen(false); settings.current?.focus(); }}>{copy.close}</button> : null}
      </div>
    </section> : null}
  </div>;
}
