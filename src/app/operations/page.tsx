import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { loadOperatorEntry } from "@/shared/infrastructure/security/auth-entry";
import {
  openOperatorOrders,
  openOperatorReport,
} from "@/shared/infrastructure/security/operator-auth/operations-console";
import { consoleResource } from "@/shared/infrastructure/security/operator-auth/console-resource";
import { operationsConsoleContent as copy } from "@/shared/infrastructure/content/operations-console-content";
import { OperationsDashboard } from "@/ui/operations-console";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: copy.title,
  robots: { index: false, follow: false },
};
export default async function OperationsPage() {
  const identity = await loadOperatorEntry();
  if (identity.status !== "ready") redirect("/operations/login");
  // Unbound verified operators may see onboarding, never business data or connection attempts.
  if (!identity.bound)
    return (
      <OperationsDashboard
        report={{ status: "unbound" }}
        orders={{ status: "unbound" }}
      />
    );
  const [report, orders] = await Promise.all([
    consoleResource(() => openOperatorReport({ days: "30" })),
    consoleResource(() => openOperatorOrders({})),
  ]);
  return <OperationsDashboard report={report} orders={orders} />;
}
