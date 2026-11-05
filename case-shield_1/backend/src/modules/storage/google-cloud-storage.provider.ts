import { StorageProvider, StoredObjectRef } from "@/modules/storage/types";
import { env } from "@/config/env";

// PRODUCTION ADAPTER (structural). Talks to Google Cloud Storage using the
// documented @google-cloud/storage SDK surface. This prototype does not
// have live GCP credentials in this sandbox, so calls below are shaped to
// be correct against that SDK but are not exercised end-to-end here — see
// docs/security-architecture.md §16 "Known Limitations."
//
// Design intent (docs/architecture.md §6): private bucket, backend-mediated
// access, CMEK via Cloud KMS where required, object versioning, explicit
// per-class lifecycle/retention — never implicit immutability.
export class GoogleCloudStorageProvider implements StorageProvider {
  readonly name = "GoogleCloudStorageProvider (production)";
  readonly id = "gcs" as const;
  private readonly bucketName: string;

  constructor() {
    if (!env.GOOGLE_CLOUD_STORAGE_BUCKET) {
      throw new Error(
        "GOOGLE_CLOUD_STORAGE_BUCKET is not configured. Set it and the other GOOGLE_CLOUD_* variables before running with CASE_SHIELD_ENV=production.",
      );
    }
    this.bucketName = env.GOOGLE_CLOUD_STORAGE_BUCKET;
  }

  private async client() {
    // Lazily imported so the dependency is only required in production mode.
    const { Storage } = await import("@google-cloud/storage");
    return new Storage({ projectId: env.GOOGLE_CLOUD_PROJECT_ID || undefined });
  }

  async put(key: string, data: Buffer, contentType: string): Promise<StoredObjectRef> {
    const storage = await this.client();
    const bucket = storage.bucket(this.bucketName);
    const file = bucket.file(key);
    await file.save(data, {
      contentType,
      resumable: false,
      metadata: {
        // CMEK is configured at the bucket level via GOOGLE_CLOUD_KMS_KEY in
        // the Terraform/deployment configuration, not per-object here.
      },
    });
    return { provider: "gcs", key };
  }

  async get(key: string): Promise<Buffer> {
    const storage = await this.client();
    const [buf] = await storage.bucket(this.bucketName).file(key).download();
    return buf;
  }

  async exists(key: string): Promise<boolean> {
    const storage = await this.client();
    const [exists] = await storage.bucket(this.bucketName).file(key).exists();
    return exists;
  }
}
