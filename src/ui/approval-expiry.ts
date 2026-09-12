/** A presentation deadline, never authorization. Monotonic elapsed time limits backward wall-clock changes. */
export function createApprovalExpiry(preparedAt: string | null, expiresAt: string | null) {
  const end = Date.parse(expiresAt ?? ""), duration = end - Date.parse(preparedAt ?? "");
  const invalid = !Number.isFinite(duration) || duration <= 0;
  let expired = invalid, started: number | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();
  const remaining = () => Math.min(end - Date.now(), duration - (started === null ? 0 : performance.now() - started));
  function check() {
    if (!expired && remaining() <= 0) {
      expired = true;
      for (const listener of listeners) listener();
    }
    return expired;
  }
  function schedule() {
    clearTimeout(timer);
    if (!check()) timer = setTimeout(schedule, Math.min(remaining(), 2_147_483_647));
  }
  return {
    check,
    getSnapshot: () => expired,
    // Keep server HTML and hydration deterministic; verify elapsed time as soon as subscribed.
    getServerSnapshot: () => invalid,
    subscribe(listener: () => void) {
      if (invalid) return () => {};
      listeners.add(listener);
      started ??= performance.now();
      if (listeners.size === 1) {
        window.addEventListener("focus", schedule);
        window.addEventListener("pageshow", schedule);
        document.addEventListener("visibilitychange", schedule);
        schedule();
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          clearTimeout(timer);
          window.removeEventListener("focus", schedule);
          window.removeEventListener("pageshow", schedule);
          document.removeEventListener("visibilitychange", schedule);
        }
      };
    },
  };
}
