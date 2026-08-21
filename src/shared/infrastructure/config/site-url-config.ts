import { z } from "zod";
import { loadRuntimeMode } from "./runtime-config";

const environmentSchema = z.object({
  BLOOMBOX_PUBLIC_ORIGIN: z.string().url().default("http://localhost:3000"),
});

export class InvalidSiteUrlConfigurationError extends Error {
  constructor() {
    super("Public site URL configuration is invalid");
    this.name = "InvalidSiteUrlConfigurationError";
  }
}

export function loadSiteUrlConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Readonly<{ origin: string }> {
  const parsed = environmentSchema.safeParse(environment);
  if (!parsed.success) throw new InvalidSiteUrlConfigurationError();
  const url = new URL(parsed.data.BLOOMBOX_PUBLIC_ORIGIN);
  const localPreview = loadRuntimeMode(environment) === "preview"
    && ["localhost", "127.0.0.1"].includes(url.hostname);
  if (url.protocol !== "https:" && !localPreview) throw new InvalidSiteUrlConfigurationError();
  return { origin: url.origin };
}
