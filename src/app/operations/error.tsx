"use client";
import { operationsConsoleContent as copy } from "@/shared/infrastructure/content/operations-console-content";
export default function OperationsError({ reset }: { reset: () => void }) {
  return (
    <div className="ops-state" role="alert">
      <h1>{copy.error}</h1>
      <p>{copy.unavailableNote}</p>
      <button className="primary-button" onClick={reset} type="button">
        {copy.retry}
      </button>
    </div>
  );
}
