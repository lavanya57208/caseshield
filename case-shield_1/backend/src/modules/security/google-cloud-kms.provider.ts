import { KeyManagementProvider } from "@/modules/security/key-management.types";
import { env } from "@/config/env";

// PRODUCTION ADAPTER (structural) — Cloud KMS, with Cloud HSM protection
// level available for higher-assurance keys where mandated. Not exercised
// without live GCP credentials in this sandbox.
export class GoogleCloudKMSProvider implements KeyManagementProvider {
  readonly name = "GoogleCloudKMSProvider (production)";

  private keyName(): string {
    if (!env.GOOGLE_CLOUD_PROJECT_ID || !env.GOOGLE_CLOUD_KMS_KEY_RING || !env.GOOGLE_CLOUD_KMS_KEY) {
      throw new Error("GOOGLE_CLOUD_KMS_* variables are not fully configured.");
    }
    return `projects/${env.GOOGLE_CLOUD_PROJECT_ID}/locations/${env.GOOGLE_CLOUD_REGION}/keyRings/${env.GOOGLE_CLOUD_KMS_KEY_RING}/cryptoKeys/${env.GOOGLE_CLOUD_KMS_KEY}`;
  }

  async wrap(plaintext: Buffer): Promise<{ ciphertext: Buffer; keyRef: string }> {
    const { KeyManagementServiceClient } = await import("@google-cloud/kms");
    const client = new KeyManagementServiceClient();
    const [result] = await client.encrypt({ name: this.keyName(), plaintext });
    return { ciphertext: Buffer.from(result.ciphertext as Uint8Array), keyRef: this.keyName() };
  }

  async unwrap(ciphertext: Buffer, keyRef: string): Promise<Buffer> {
    const { KeyManagementServiceClient } = await import("@google-cloud/kms");
    const client = new KeyManagementServiceClient();
    const [result] = await client.decrypt({ name: keyRef, ciphertext });
    return Buffer.from(result.plaintext as Uint8Array);
  }
}
