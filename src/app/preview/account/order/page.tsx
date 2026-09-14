import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadRuntimeMode } from "@/shared/infrastructure/config/runtime-config";
import { customerAccountContent as copy } from "@/shared/infrastructure/content/customer-account-content";
import { CustomerOrderDetailPanel } from "@/ui/customer-order-detail";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: copy.detail.previewTitle, robots: { index: false, follow: false } };
export default async function CustomerOrderPreview({ searchParams }: { searchParams: Promise<{ sample?: string | string[] }> }) {
  if (loadRuntimeMode() !== "preview") notFound();
  const large = (await searchParams).sample === "sample-2";
  return <CustomerOrderDetailPanel preview state={{ status: "ready", order: {
    id: large ? "sample-2" : "sample-1", name: large ? "#SAMPLE-1001" : "#SAMPLE-1002",
    orderedAt: large ? "2026-09-01T04:00:00Z" : "2026-09-10T04:00:00Z", totalYen: large ? 8000 : 5000,
    subtotalYen: large ? 8000 : 4000, shippingYen: large ? 0 : 1000, taxYen: 0, discountYen: 0,
    payment: "CAPTURED", fulfillment: large ? "SHIPPED" : "PENDING_FULFILLMENT", cancelled: false,
    items: [{ name: large ? copy.detail.sampleLargeProduct : copy.detail.sampleProduct, quantity: 1, unitYen: large ? 8000 : 4000, totalYen: large ? 8000 : 4000 }],
  } }} />;
}
