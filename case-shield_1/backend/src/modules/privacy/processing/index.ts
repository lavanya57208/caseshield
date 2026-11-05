import { DocumentProcessor } from "@/modules/privacy/processing/processor.types";
import { PdfProcessor } from "@/modules/privacy/processing/pdf.processor";
import { PlainTextProcessor } from "@/modules/privacy/processing/plain-text.processor";

const processors: Record<string, DocumentProcessor> = {
  "application/pdf": new PdfProcessor(),
  "text/plain": new PlainTextProcessor(),
};

/**
 * Returns the processor for a MIME type, or null when no safe processor
 * exists yet (images, audio/video, Office documents). Callers must treat
 * null as UNSUPPORTED and leave the original untouched.
 */
export function getDocumentProcessor(mimeType: string): DocumentProcessor | null {
  return processors[mimeType] ?? null;
}

export * from "@/modules/privacy/processing/processor.types";
