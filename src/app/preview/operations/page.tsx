import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadRuntimeMode } from "@/shared/infrastructure/config/runtime-config";
import { operationsConsoleContent as copy } from "@/shared/infrastructure/content/operations-console-content";
import { OperationsShell } from "@/ui/operations-shell";
import { OperationsDashboard } from "@/ui/operations-console";
import type {
  OperatorOrderPage,
  OperatorOrderReport,
} from "@/modules/order/public";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: copy.previewDemo,
  robots: { index: false, follow: false },
};
export default async function PreviewOperations({
  searchParams,
}: {
  searchParams: Promise<{ state?: string | string[] }>;
}) {
  if (loadRuntimeMode() !== "preview") notFound();
  const { state } = await searchParams;
  // Synthetic presentation fixtures only. This route never reads a session, business database or secrets.
  const daily = Array.from({ length: 30 }, (_, i) => ({
    day: new Date(Date.UTC(2026, 7, 19 + i)).toISOString().slice(0, 10),
    orders: state === "empty" ? 0 : (i * 7) % 9,
    orderValueYen: state === "empty" ? 0 : ((i * 7) % 9) * 5000,
  }));
  const report: OperatorOrderReport = {
    days: 30,
    since: "2026-08-18T15:00:00.000Z",
    until: "2026-09-17T09:00:00.000Z",
    orders: daily.reduce((n, d) => n + d.orders, 0),
    orderValueYen: daily.reduce((n, d) => n + d.orderValueYen, 0),
    captured: state === "empty" ? 0 : 80,
    refunds: state === "empty" ? 0 : 2,
    awaitingShipment: state === "empty" ? 0 : 6,
    cancelled: 0,
    daily,
  };
  const orders: OperatorOrderPage = {
    next: null,
    orders:
      state === "empty"
        ? []
        : [
            {
              id: "sample-1",
              name: "SAMPLE-1002",
              customerId: null,
              orderedAt: "2026-09-17T03:00:00Z",
              totalYen: 5000,
              status: "CONFIRMED",
              payment: ["CAPTURED"],
              fulfillment: ["UNFULFILLED"],
            },
            {
              id: "sample-2",
              name: "SAMPLE-1001",
              customerId: null,
              orderedAt: "2026-09-16T03:00:00Z",
              totalYen: 8000,
              status: "CONFIRMED",
              payment: ["CAPTURED"],
              fulfillment: ["SHIPPED"],
            },
          ],
  };
  return (
    <OperationsShell
      logout={<span className="ops-caption">{copy.previewDemo}</span>}
    >
      <aside className="ops-panel">
        <strong>{copy.previewDemo}</strong>
        <p>{copy.previewDemoNote}</p>
      </aside>
      <OperationsDashboard
        report={
          state === "unavailable"
            ? { status: "unavailable" }
            : { status: "ready", value: report }
        }
        orders={
          state === "unavailable"
            ? { status: "unavailable" }
            : { status: "ready", value: orders }
        }
      />
    </OperationsShell>
  );
}
