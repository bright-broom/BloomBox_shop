import { describe, expect, it } from "vitest";
import { AesGcmDataProtector, DataProtectionError } from "./aes-gcm-data-protector";

const keyring = {
  activeKeyId: "key-2026-08",
  keys: new Map([["key-2026-08", Buffer.alloc(32, 7)]]),
};

describe("AesGcmDataProtector", () => {
  it("encrypts and authenticates sensitive data with contextual binding", () => {
    const protector = new AesGcmDataProtector(keyring);
    const protectedData = protector.protect("花子", "intent:123:recipient");

    expect(protectedData.ciphertext.toString("utf8")).not.toContain("花子");
    expect(protector.unprotect(protectedData, "intent:123:recipient")).toBe("花子");
  });

  it("rejects the same ciphertext in a different context", () => {
    const protector = new AesGcmDataProtector(keyring);
    const protectedData = protector.protect("秘密", "intent:123:gift");

    expect(() => protector.unprotect(protectedData, "intent:456:gift"))
      .toThrow(DataProtectionError);
  });

  it("rejects tampered ciphertext without exposing sensitive details", () => {
    const protector = new AesGcmDataProtector(keyring);
    const protectedData = protector.protect("秘密", "intent:123:gift");
    const tampered = Buffer.from(protectedData.ciphertext);
    tampered[tampered.length - 1] ^= 1;

    expect(() => protector.unprotect({ ...protectedData, ciphertext: tampered }, "intent:123:gift"))
      .toThrow(DataProtectionError);
  });
});
