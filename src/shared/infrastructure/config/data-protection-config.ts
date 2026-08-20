import { z } from "zod";

const serializedKeyringSchema = z.object({
  activeKeyId: z.string().trim().min(1),
  keys: z.record(z.string().trim().min(1), z.string().trim().min(1)),
});

export type DataProtectionConfig = Readonly<{
  activeKeyId: string;
  keys: ReadonlyMap<string, Buffer>;
}>;

export class InvalidDataProtectionConfigurationError extends Error {
  constructor() {
    super("Data protection configuration is invalid");
    this.name = "InvalidDataProtectionConfigurationError";
  }
}

export function loadDataProtectionConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): DataProtectionConfig {
  const serialized = environment.BLOOMBOX_PII_KEYRING;
  if (!serialized) throw new InvalidDataProtectionConfigurationError();

  let json: unknown;
  try {
    json = JSON.parse(serialized);
  } catch {
    throw new InvalidDataProtectionConfigurationError();
  }

  const parsed = serializedKeyringSchema.safeParse(json);
  if (!parsed.success || !(parsed.data.activeKeyId in parsed.data.keys)) {
    throw new InvalidDataProtectionConfigurationError();
  }

  const keys = new Map<string, Buffer>();
  for (const [keyId, encodedKey] of Object.entries(parsed.data.keys)) {
    const key = Buffer.from(encodedKey, "base64");
    if (key.length !== 32) throw new InvalidDataProtectionConfigurationError();
    keys.set(keyId, key);
  }

  return { activeKeyId: parsed.data.activeKeyId, keys };
}
