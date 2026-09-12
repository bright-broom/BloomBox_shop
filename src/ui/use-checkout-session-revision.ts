"use client";

import {
  CHECKOUT_SESSION_CHANGED_EVENT,
  readBrowserCheckoutSessionSnapshot,
} from "@/modules/checkout/presentation/browser-checkout-session";
import { useSyncExternalStore } from "react";
export { CHECKOUT_SESSION_UNAVAILABLE } from "@/modules/checkout/presentation/browser-checkout-session";

export function useCheckoutSessionRevision(): string | null {
  return useSyncExternalStore(
    subscribe,
    readBrowserCheckoutSessionSnapshot,
    () => null,
  );
}

function subscribe(onStoreChange: () => void): () => void {
  window.addEventListener(CHECKOUT_SESSION_CHANGED_EVENT, onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    window.removeEventListener(CHECKOUT_SESSION_CHANGED_EVENT, onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}
