import Link from "next/link";
import type { RuntimeMode } from "@/shared/infrastructure/config/runtime-config";
import type { CheckoutProviderMode } from "@/shared/infrastructure/config/checkout-provider-config";
import { giftExperienceContent } from "@/shared/infrastructure/content/gift-experience-content";
import { referralContent } from "@/shared/infrastructure/content/referral-content";

export function PreviewFooterLinks({ runtime, checkout }: { runtime: RuntimeMode; checkout: CheckoutProviderMode }) {
  if (runtime !== "preview") return null;
  return <>
    <li><Link href="/preview/gift-experience">{giftExperienceContent.preview.navLabel}</Link></li>
    {checkout === "preview" ? <li><Link href="/referrals">{referralContent.navLabel}</Link></li> : null}
  </>;
}
