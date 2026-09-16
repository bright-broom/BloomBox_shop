import { operationsConsoleContent as copy } from "@/shared/infrastructure/content/operations-console-content";
export default function Loading() {
  return (
    <div className="ops-state" role="status">
      <p>{copy.loading}</p>
      <div className="ops-loading-lines" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}
