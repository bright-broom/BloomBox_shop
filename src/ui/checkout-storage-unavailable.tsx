"use client";

import Link from "next/link";
import { giftExperienceContent } from "@/shared/infrastructure/content/gift-experience-content";

export function CheckoutStorageUnavailable() {
  const copy = giftExperienceContent.storageUnavailable;
  return (
    <div className="checkout-empty">
      <div role="alert">
        <h2>{copy.title}</h2>
        <p>{copy.message}</p>
      </div>
      <button className="primary-button" type="button" onClick={() => window.location.reload()}>{copy.retry}</button>
      <Link className="text-link" href="/flowers">{copy.browse}</Link>
    </div>
  );
}
