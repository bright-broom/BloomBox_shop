import { z } from "zod";

const workerEnvironmentSchema = z.object({
  COMMERCE_WORKER_SECRET: z.string().min(32).max(256),
});

export class InvalidWorkerConfigurationError extends Error {
  constructor() {
    super("Commerce worker configuration is invalid");
    this.name = "InvalidWorkerConfigurationError";
  }
}

export function loadCommerceWorkerSecret(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const parsed = workerEnvironmentSchema.safeParse(environment);
  if (!parsed.success) throw new InvalidWorkerConfigurationError();
  return parsed.data.COMMERCE_WORKER_SECRET;
}
