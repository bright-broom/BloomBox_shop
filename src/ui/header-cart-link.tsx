"use client";

import {
  CHECKOUT_SESSION_CHANGED_EVENT,
  readBrowserCartQuantity,
} from "@/modules/checkout/presentation/browser-checkout-session";
import Link from "next/link";
import { useEffect, useState } from "react";

export function HeaderCartLink() {
  const [quantity, setQuantity] = useState<number | null>(null);

  useEffect(() => {
    const refresh = () => setQuantity(readBrowserCartQuantity());
    refresh();
    window.addEventListener(CHECKOUT_SESSION_CHANGED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(CHECKOUT_SESSION_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  return (
    <Link className="header-cart" href="/cart" aria-label={quantity === null ? "カート、件数を確認できません" : `カート、${quantity} 点`}>
      カート <span aria-hidden="true">{quantity ?? "—"}</span>
    </Link>
  );
}
