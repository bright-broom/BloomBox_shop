"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section className="state-page section-shell">
      <p className="eyebrow">SOMETHING WENT WRONG</p>
      <h1>うまく花を<br />束ねられませんでした。</h1>
      <p>少し時間をおいて、もう一度お試しください。</p>
      <button className="primary-button" type="button" onClick={reset}>もう一度試す →</button>
    </section>
  );
}
