import { giftExperienceContent } from "@/shared/infrastructure/content/gift-experience-content";

export function FlowerLoading({ compact = false, title, tipIndex = 0 }: { compact?: boolean; title?: string; tipIndex?: number }) {
  const copy = giftExperienceContent.loading;
  return <div className={compact ? "flower-progress" : "loading-state"}>
    <div role="status" aria-live="polite" aria-atomic="true">
      <span className="loading-flower" aria-hidden="true">✣</span>
      <p>{title ?? copy.title}</p>
    </div>
    <p className="field-note">{copy.note}</p>
    <aside className="flower-tip" aria-label={copy.tipLabel}>
      <p className="eyebrow">{copy.tipLabel}</p>
      <p>{copy.tips[tipIndex] ?? copy.tips[0]}</p>
    </aside>
  </div>;
}
