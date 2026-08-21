"use client";

import {
  CHECKOUT_SESSION_CHANGED_EVENT,
  readCart,
} from "@/modules/checkout/presentation/browser-checkout-session";
import Link from "next/link";
import { useEffect, useState } from "react";

export function HeaderCartLink() {
  const [quantity, setQuantity] = useState(0);

  useEffect(() => {
    const refresh = () => setQuantity(readCart(window.sessionStorage)?.quantity ?? 0);
    refresh();
    window.addEventListener(CHECKOUT_SESSION_CHANGED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(CHECKOUT_SESSION_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  return (
    <Link className="header-cart" href="/cart" aria-label={`カート、${quantity} 点`}>
      カート <span aria-hidden="true">{quantity}</span>
    </Link>
  );
}
