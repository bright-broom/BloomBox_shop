"use client";

import { useEffect } from "react";
import {
  CartChangedError,
  readRecoverableCart,
  removeCart,
} from "@/modules/checkout/presentation/browser-checkout-session";

type CartStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type CompletedCheckoutCartCleanupResult = "cleared" | "kept" | "unavailable";

/**
 * Production does not otherwise clear the browser cart after payment. Once the order exists, remove only the cart
 * that started this checkout, so it no longer looks unpaid. Any other cart is left untouched, and a failure here is
 * harmless: pressing checkout again for the finished purchase still cannot start a duplicate order.
 */
export function clearCompletedCheckoutCart(
  readStorage: () => CartStorage,
  purchaseIntentId: string,
): CompletedCheckoutCartCleanupResult {
  try {
    const storage = readStorage();
    if (readRecoverableCart(storage)?.requestId !== purchaseIntentId) return "kept";
    removeCart(storage, purchaseIntentId);
    return "cleared";
  } catch (error) {
    return error instanceof CartChangedError ? "kept" : "unavailable";
  }
}

export function CompletedCheckoutCartCleanup({ purchaseIntentId }: { purchaseIntentId: string }) {
  useEffect(() => {
    clearCompletedCheckoutCart(() => window.sessionStorage, purchaseIntentId);
  }, [purchaseIntentId]);
  return null;
}
