// OCRProvider — see docs/ai-architecture.md §OCR. OCR produces a DERIVED
// text representation of an image or scanned PDF; the original file is only
// ever read. Providers must report honestly: a provider that could not
// recognize text returns FAILED (or PARTIAL), never an empty COMPLETED.

export type OcrStatus = "COMPLETED" | "PARTIAL" | "FAILED" | "UNSUPPORTED";

export interface OcrPage {
  pageNumber: number;
  text: string;
  /** 0..1 when the provider reports it. */
  confidence?: number;
}

export interface OcrResult {
  status: OcrStatus;
  pages: OcrPage[];
  /** Mean page confidence, 0..1, when available. */
  confidence?: number;
  /** BCP-47 language code when detected. */
  language?: string;
  limitations: string[];
  /** Safe, content-free reason for FAILED / UNSUPPORTED / PARTIAL. */
  error?: string;
}

export interface OcrInput {
  buffer: Buffer;
  mimeType: string;
  fileName: string;
}

export interface OCRProvider {
  providerName(): string;
  /** True when the provider sends content outside this process (e.g. a cloud API). */
  readonly external: boolean;
  supportsMimeType(mimeType: string): boolean;
  extractText(input: OcrInput): Promise<OcrResult>;
}

/** MIME types for which OCR is attempted at all (subject to supportsMimeType). */
export const OCR_CANDIDATE_MIME_TYPES = new Set(["application/pdf", "image/png", "image/jpeg", "image/tiff"]);

export function summarizePages(pages: OcrPage[], limitations: string[] = []): Pick<OcrResult, "status" | "confidence" | "limitations" | "error"> {
  const withText = pages.filter((p) => p.text.trim().length > 0);
  const confidences = pages.map((p) => p.confidence).filter((c): c is number => typeof c === "number");
  const confidence = confidences.length ? Math.round((confidences.reduce((a, b) => a + b, 0) / confidences.length) * 100) / 100 : undefined;
  if (withText.length === 0) return { status: "FAILED", confidence, limitations, error: "No text could be recognized in the document." };
  const lowConfidence = confidences.some((c) => c < 0.5);
  if (withText.length < pages.length || lowConfidence) {
    const notes = [...limitations];
    if (withText.length < pages.length) notes.push(`${pages.length - withText.length} of ${pages.length} page(s) produced no text.`);
    if (lowConfidence) notes.push("Some pages were recognized with low confidence; verify the text before relying on it.");
    return { status: "PARTIAL", confidence, limitations: notes, error: "OCR recognized only part of the document." };
  }
  return { status: "COMPLETED", confidence, limitations };
}
