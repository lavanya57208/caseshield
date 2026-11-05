import crypto from "crypto";
import { KeyManagementProvider } from "@/modules/security/key-management.types";
import { logger } from "@/lib/logger";

// DEVELOPMENT ADAPTER — a local, process-lifetime AES-256-GCM key. This is
// explicitly NOT production key management: the key is not persisted,
// rotated, or access-controlled. Production uses Cloud KMS / Cloud HSM
// behind the same interface (google-cloud-kms.provider.ts).
export class DevelopmentKeyProvider implements KeyManagementProvider {
  readonly name = "DevelopmentKeyProvider (development, NOT for production data)";
  private readonly key: Buffer;

  constructor() {
    this.key = crypto.randomBytes(32);
    logger.warn(
      "DevelopmentKeyProvider is active: an ephemeral, non-persistent key is in use. This is safe only for local development.",
    );
  }

  async wrap(plaintext: Buffer): Promise<{ ciphertext: Buffer; keyRef: string }> {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return { ciphertext: Buffer.concat([iv, tag, encrypted]), keyRef: "development-local-key" };
  }

  async unwrap(ciphertext: Buffer, _keyRef: string): Promise<Buffer> {
    const iv = ciphertext.subarray(0, 12);
    const tag = ciphertext.subarray(12, 28);
    const encrypted = ciphertext.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
  }
}
