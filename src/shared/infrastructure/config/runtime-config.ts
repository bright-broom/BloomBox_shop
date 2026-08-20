import { z } from "zod";

const runtimeEnvironmentSchema = z.object({
  BLOOMBOX_RUNTIME_MODE: z.enum(["preview", "production"]).default("preview"),
});

export type RuntimeMode = "preview" | "production";

export class InvalidRuntimeConfigurationError extends Error {
  constructor() {
    super("Runtime configuration is invalid");
    this.name = "InvalidRuntimeConfigurationError";
  }
}

export function loadRuntimeMode(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): RuntimeMode {
  const parsed = runtimeEnvironmentSchema.safeParse(environment);
  if (!parsed.success) throw new InvalidRuntimeConfigurationError();
  return parsed.data.BLOOMBOX_RUNTIME_MODE;
}
