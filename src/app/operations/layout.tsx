import type { ReactNode } from "react";
import { OperationsShell } from "@/ui/operations-shell";
import { operationsConsoleContent as copy } from "@/shared/infrastructure/content/operations-console-content";
import { endOperatorLogin } from "./actions";
// Navigation only. Each page and data operation independently enforces authentication/authorization.
export default function OperationsLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <OperationsShell
      logout={
        <form action={endOperatorLogin}>
          <button className="text-button" type="submit">
            {copy.signOut}
          </button>
        </form>
      }
    >
      {children}
    </OperationsShell>
  );
}
