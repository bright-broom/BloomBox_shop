import Link from "next/link";
import { operatorPermissionsContent as copy } from "@/shared/infrastructure/content/operator-permissions-content";
export default function PermissionManagementUnavailable() {
  return <section className="section-shell content-page">
    <header className="content-header"><h1>{copy.deniedTitle}</h1><p>{copy.messages.NOT_AUTHORIZED}</p></header>
    <Link className="primary-button" href="/operations">{copy.login}</Link>
  </section>;
}
