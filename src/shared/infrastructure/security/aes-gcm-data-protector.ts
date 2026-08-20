import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { DataProtectionConfig } from "../config/data-protection-config";

const FORMAT_VERSION = 1;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

export type ProtectedData = Readonly<{
  keyId: string;
  ciphertext: Buffer;
}>;

export class DataProtectionError extends Error {
  constructor() {
    super("Protected data could not be processed");
    this.name = "DataProtectionError";
  }
}

export class AesGcmDataProtector {
  constructor(private readonly config: DataProtectionConfig) {}

  protect(plaintext: string, context: string): ProtectedData {
    const key = this.config.keys.get(this.config.activeKeyId);
    if (!key || !context) throw new DataProtectionError();

    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(context, "utf8"));
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return {
      keyId: this.config.activeKeyId,
      ciphertext: Buffer.concat([Buffer.from([FORMAT_VERSION]), iv, authTag, encrypted]),
    };
  }

  unprotect(protectedData: ProtectedData, context: string): string {
    try {
      const { ciphertext } = protectedData;
      const key = this.config.keys.get(protectedData.keyId);
      const minimumLength = 1 + IV_LENGTH + AUTH_TAG_LENGTH;
      if (!key || !context || ciphertext.length < minimumLength || ciphertext[0] !== FORMAT_VERSION) {
        throw new DataProtectionError();
      }

      const ivStart = 1;
      const tagStart = ivStart + IV_LENGTH;
      const encryptedStart = tagStart + AUTH_TAG_LENGTH;
      const decipher = createDecipheriv(
        "aes-256-gcm",
        key,
        ciphertext.subarray(ivStart, tagStart),
      );
      decipher.setAAD(Buffer.from(context, "utf8"));
      decipher.setAuthTag(ciphertext.subarray(tagStart, encryptedStart));
      return Buffer.concat([
        decipher.update(ciphertext.subarray(encryptedStart)),
        decipher.final(),
      ]).toString("utf8");
    } catch (error) {
      if (error instanceof DataProtectionError) throw error;
      throw new DataProtectionError();
    }
  }
}
