"use client";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { operationsConsoleContent as copy } from "@/shared/infrastructure/content/operations-console-content";
export function OperationsRefresh() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className="text-button"
      disabled={pending}
      aria-busy={pending}
      onClick={() => start(() => router.refresh())}
    >
      {pending ? copy.loading : copy.refresh}
    </button>
  );
}
