"use client";

import { useRef, type ReactNode } from "react";

/** Native disclosure retains keyboard support and works before hydration. */
export function MobileNavigation({ children }: { children: ReactNode }) {
  const menu = useRef<HTMLDetailsElement>(null);

  return (
    <details
      className="mobile-menu"
      ref={menu}
      onClick={(event) => {
        if (event.target instanceof Element && event.target.closest("a") && menu.current) {
          menu.current.open = false;
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && menu.current?.open) {
          menu.current.open = false;
          menu.current.querySelector("summary")?.focus();
        }
      }}
    >
      <summary>メニュー</summary>
      <nav aria-label="モバイルナビゲーション">{children}</nav>
    </details>
  );
}
