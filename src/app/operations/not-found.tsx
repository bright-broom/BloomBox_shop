import Link from "next/link";
import { operatorLoginContent as copy } from "@/shared/infrastructure/content/operator-login-content";
export default function OperationNotFound() {
  return <section className="section-shell content-page"><h1>{copy.deniedTitle}</h1><p>{copy.deniedNote}</p>
    <Link className="text-link" prefetch={false} href="/operations">{copy.dashboardTitle}</Link></section>;
}
