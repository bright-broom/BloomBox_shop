import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { ReferralProgram } from "@/modules/referral/public";
import { loadRuntimeMode } from "../config/runtime-config";
import { loadCheckoutProviderMode } from "../config/checkout-provider-config";

const COOKIE = "bloombox_referral_preview";
const PREVIOUS_COOKIE = "bloombox_referral_preview_previous";
export const PREVIEW_REFERRAL_MEMBER_LIMIT = 1_000;
export const PREVIEW_REFERRAL_ORDER_LIMIT = 5_000;

// This state is process-local and carries no PII. It is never a production adapter.
const runtime = globalThis as typeof globalThis & { bloomBoxPreviewReferrals?: ReferralProgram };

export class PreviewReferralUnavailableError extends Error {
  constructor() { super("Preview referrals are unavailable"); this.name = "PreviewReferralUnavailableError"; }
}

export function getPreviewReferralProgram(): ReferralProgram {
  if (loadRuntimeMode() !== "preview" || loadCheckoutProviderMode() !== "preview") {
    throw new PreviewReferralUnavailableError();
  }
  runtime.bloomBoxPreviewReferrals ??= new ReferralProgram();
  return runtime.bloomBoxPreviewReferrals;
}

export async function previewReferralMember(): Promise<string | null> {
  const program = getPreviewReferralProgram();
  const id = (await cookies()).get(COOKIE)?.value;
  return id && program.hasMember(id) ? id : null;
}

export async function enrollPreviewReferralMember(fresh = false): Promise<string> {
  const program = getPreviewReferralProgram();
  const current = await previewReferralMember();
  if (current && !fresh) return current;
  if (program.size >= PREVIEW_REFERRAL_MEMBER_LIMIT) throw new PreviewReferralUnavailableError();
  const id = randomBytes(32).toString("hex");
  program.enroll(id, `BB-${randomBytes(12).toString("hex").toUpperCase()}`);
  const jar = await cookies();
  if (fresh && current) jar.set(PREVIOUS_COOKIE, current, cookieOptions());
  jar.set(COOKIE, id, cookieOptions());
  return id;
}

export async function switchPreviewReferralMember(): Promise<void> {
  const program = getPreviewReferralProgram();
  const jar = await cookies();
  const previous = jar.get(PREVIOUS_COOKIE)?.value;
  const current = await previewReferralMember();
  if (!previous || !program.hasMember(previous) || !current) throw new PreviewReferralUnavailableError();
  jar.set(COOKIE, previous, cookieOptions());
  jar.set(PREVIOUS_COOKIE, current, cookieOptions());
}

function cookieOptions() {
  return { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: 86_400 };
}
