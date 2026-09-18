import { z } from "zod";

/** Google tag loader for GA4. Only this script is loaded, and only after consent (ADR 0018). */
export const GA4_SCRIPT_URL = "https://www.googletagmanager.com/gtag/js";

const measurementIdSchema = z.string().regex(/^G-[A-Z0-9]{4,20}$/);

export type AnalyticsConfig =
  | Readonly<{ enabled: false }>
  | Readonly<{ enabled: true; measurementId: string; scriptUrl: string }>;

export class InvalidAnalyticsConfigurationError extends Error {
  constructor() {
    super("Analytics configuration is invalid");
    this.name = "InvalidAnalyticsConfigurationError";
  }
}

/** GA4 is off unless BLOOMBOX_GA4_MEASUREMENT_ID is set. A malformed ID is a configuration error, never a guess. */
export function loadAnalyticsConfig(environment: Readonly<Record<string, string | undefined>> = process.env): AnalyticsConfig {
  const raw = environment.BLOOMBOX_GA4_MEASUREMENT_ID;
  if (raw === undefined || raw === "") return { enabled: false };
  const parsed = measurementIdSchema.safeParse(raw);
  if (!parsed.success) throw new InvalidAnalyticsConfigurationError();
  return { enabled: true, measurementId: parsed.data, scriptUrl: `${GA4_SCRIPT_URL}?id=${encodeURIComponent(parsed.data)}` };
}

/** For rendering and the CSP: an invalid configuration disables analytics instead of breaking pages. */
export function analyticsSettingsOrDisabled(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  report: (error: unknown) => void = () => undefined,
): AnalyticsConfig {
  try {
    return loadAnalyticsConfig(environment);
  } catch (error) {
    report(error);
    return { enabled: false };
  }
}
