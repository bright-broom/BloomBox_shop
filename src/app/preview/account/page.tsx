import { loyaltyProgress } from "@/modules/customer/public";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { loadRuntimeMode } from "@/shared/infrastructure/config/runtime-config";
import { customerAccountContent as copy } from "@/shared/infrastructure/content/customer-account-content";
import { CustomerAccountPanel } from "@/ui/customer-account";
import type { CustomerAccount } from "@/modules/customer/public";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: copy.previewTitle, robots: { index: false, follow: false } };
const scenarios = ["orders", "empty", "signed-out", "expired", "unavailable"] as const;
export default async function AccountPreview({ searchParams }: { searchParams: Promise<{ state?: string | string[]; rank?: string | string[] }> }) {
  if (loadRuntimeMode() !== "preview") notFound();
  const { state, rank } = await searchParams;
  const scenario = scenarios.find((item) => item === state) ?? "orders";
  // Synthetic, read-only design data. This route never creates a login or reads a customer cookie.
  const account: CustomerAccount = { name: copy.sampleName, email: copy.sampleEmail, nextCursor: null,
    orders: scenario === "empty" ? [] : [
      { id: "sample-1", name: "#SAMPLE-1002", orderedAt: "2026-09-10T04:00:00Z", items: [{ name: copy.detail.sampleProduct, quantity: 1 }], totalYen: 5000, payment: "PAID", fulfillment: "UNFULFILLED", cancelled: false },
      { id: "sample-2", name: "#SAMPLE-1001", orderedAt: "2026-09-01T04:00:00Z", items: [{ name: copy.detail.sampleLargeProduct, quantity: 1 }], totalYen: 8000, payment: "PAID", fulfillment: "FULFILLED", cancelled: false },
    ] };
  return <><nav className="section-shell account-scenarios" aria-label={copy.scenariosLabel}>
    {scenarios.map((item) => <Link className="text-link" key={item} href={`/preview/account?state=${item}`}
      aria-current={scenario === item ? "page" : undefined}>{copy.scenarios[item]}</Link>)}</nav>
    <CustomerAccountPanel preview state={scenario === "orders" || scenario === "empty" ? { status: "ready", account, loyalty: rank === "unavailable" ? { status: "unavailable" } : { status: "ready", progress: loyaltyProgress(scenario === "empty" ? 0 : rank === "top" ? 60_000 : 12_000) } } : { status: scenario }}
      controls={<button className="secondary-button" disabled>{scenario === "orders" || scenario === "empty" ? copy.signOut : copy.signIn}</button>} /></>;
}
