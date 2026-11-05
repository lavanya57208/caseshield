import { env } from "@/config/env";
import { PiiDetectionProvider } from "@/modules/privacy/pii/pii.types";
import { DeterministicPiiDetectionProvider } from "@/modules/privacy/pii/deterministic-pii.provider";

let instance: PiiDetectionProvider | undefined;

// Single factory point, mirroring getStorageProvider(). Only the
// deterministic provider exists today; an AI/NLP provider (e.g. Cloud DLP
// or a Vertex AI NER model) would be added here behind PII_PROVIDER.
export function getPiiDetectionProvider(): PiiDetectionProvider {
  if (!instance) {
    switch (env.PII_PROVIDER) {
      case "deterministic":
      default:
        instance = new DeterministicPiiDetectionProvider();
    }
  }
  return instance;
}

export * from "@/modules/privacy/pii/pii.types";
