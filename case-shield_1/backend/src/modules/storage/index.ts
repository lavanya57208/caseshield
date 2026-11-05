import { env, isProduction } from "@/config/env";
import { StorageProvider } from "@/modules/storage/types";
import { LocalStorageProvider } from "@/modules/storage/local-storage.provider";
import { GoogleCloudStorageProvider } from "@/modules/storage/google-cloud-storage.provider";

let instance: StorageProvider | undefined;

// Single factory point — every module imports getStorageProvider(), never a
// concrete class. See docs/architecture.md §6. STORAGE_PROVIDER (optional)
// overrides the CASE_SHIELD_ENV-derived default.
export function getStorageProvider(): StorageProvider {
  if (!instance) {
    const selected = env.STORAGE_PROVIDER ?? (isProduction ? "gcs" : "local");
    instance = selected === "gcs" ? new GoogleCloudStorageProvider() : new LocalStorageProvider();
  }
  return instance;
}

export * from "@/modules/storage/types";
