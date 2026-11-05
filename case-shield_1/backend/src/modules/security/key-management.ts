import { isProduction } from "@/config/env";
import { KeyManagementProvider } from "@/modules/security/key-management.types";
import { DevelopmentKeyProvider } from "@/modules/security/development-key.provider";
import { GoogleCloudKMSProvider } from "@/modules/security/google-cloud-kms.provider";

let instance: KeyManagementProvider | undefined;

export function getKeyManagementProvider(): KeyManagementProvider {
  if (!instance) {
    instance = isProduction ? new GoogleCloudKMSProvider() : new DevelopmentKeyProvider();
  }
  return instance;
}
