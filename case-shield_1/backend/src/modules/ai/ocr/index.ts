import { env } from "@/config/env";
import { OCRProvider } from "@/modules/ai/ocr/ocr-provider.types";
import { MockOCRProvider } from "@/modules/ai/ocr/mock-ocr.provider";
import { DocumentAIOCRProvider } from "@/modules/ai/ocr/document-ai-ocr.provider";

let instance: OCRProvider | undefined;

/** OCR_PROVIDER when set, otherwise follows AI_PROVIDER (mock -> mock OCR). */
export function resolveOcrProviderKey(): "mock" | "document-ai" {
  return env.OCR_PROVIDER ?? (env.AI_PROVIDER === "mock" ? "mock" : "document-ai");
}

export function getOCRProvider(): OCRProvider {
  if (!instance) instance = resolveOcrProviderKey() === "mock" ? new MockOCRProvider() : new DocumentAIOCRProvider();
  return instance;
}

export * from "@/modules/ai/ocr/ocr-provider.types";
