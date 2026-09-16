"use client";
import { usePathname } from "next/navigation";
import Link from "next/link";
import type { ReactNode } from "react";
import { customerPortalContent as portalCopy } from "@/shared/infrastructure/content/customer-portal-content";
import { operationsConsoleContent as copy } from "@/shared/infrastructure/content/operations-console-content";
import { OperationsIcon } from "./operations-icon";
export function OperationsShell({
  children,
  logout,
}: {
  children: ReactNode;
  logout: ReactNode;
}) {
  const path = usePathname();
  if (path === "/operations/login") return children;
  return (
    <div className="operations-shell">
      <aside className="ops-sidebar">
        <Link className="ops-brand" href="/operations">
          BloomBox<span>{copy.navigation}</span>
        </Link>
        <nav aria-label={copy.navigation}>
          {copy.navigationItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              prefetch={false}
              aria-current={
                (
                  item.href === "/operations"
                    ? path === item.href
                    : path.startsWith(item.href)
                )
                  ? "page"
                  : undefined
              }
            >
              <OperationsIcon name={item.icon} />
              <span>{copy[item.key]}</span>
            </Link>
          ))}
          <Link href="/operations/requests" prefetch={false} aria-current={path === "/operations/requests" ? "page" : undefined}><OperationsIcon name="customers" /><span>{portalCopy.support}</span></Link>
        </nav>
        <div className="ops-sidebar-bottom">
          <Link href="/">
            {copy.store}
            <OperationsIcon name="arrow" />
          </Link>
          {logout}
        </div>
      </aside>
      <div className="ops-workspace">{children}</div>
    </div>
  );
}
