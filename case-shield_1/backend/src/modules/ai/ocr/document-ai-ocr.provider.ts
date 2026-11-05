import { env } from "@/config/env";
import { GoogleTransport, defaultGoogleTransport, requireGoogleProject } from "@/modules/ai/google-rest";
import { OCRProvider, OcrInput, OcrPage, OcrResult, summarizePages } from "@/modules/ai/ocr/ocr-provider.types";

// PRODUCTION ADAPTER — Google Document AI (OCR processor), online/synchronous
// `:process` REST call. Not exercised against a live project in this
// environment (no credentials); request shaping and response parsing are
// unit-tested with an injected transport. Authorization and the RESTRICTED
// policy are enforced by the pipeline BEFORE this adapter is called.
//
// Limits (online processing): ~20 MB inline payload and a per-request page
// cap set by the processor. Larger files return UNSUPPORTED here; batch
// processing via GCS + Pub/Sub is the documented future path.

const SUPPORTED = new Set(["application/pdf", "image/png", "image/jpeg", "image/tiff", "image/gif", "image/bmp", "image/webp"]);
const MAX_INLINE_BYTES = 20 * 1024 * 1024;

export class DocumentAIOCRProvider implements OCRProvider {
  readonly external = true;

  constructor(private readonly transport: GoogleTransport = defaultGoogleTransport) {}

  providerName() {
    return "Google Document AI (OCR processor)";
  }

  supportsMimeType(mimeType: string) {
    return SUPPORTED.has(mimeType);
  }

  endpoint(): string {
    const { project } = requireGoogleProject("Document AI");
    if (!env.DOCUMENT_AI_PROCESSOR_ID) throw new Error("Document AI is not configured. Set DOCUMENT_AI_PROCESSOR_ID.");
    const location = env.DOCUMENT_AI_LOCATION || "us";
    return `https://${location}-documentai.googleapis.com/v1/projects/${project}/locations/${location}/processors/${env.DOCUMENT_AI_PROCESSOR_ID}:process`;
  }

  async extractText(input: OcrInput): Promise<OcrResult> {
    if (!this.supportsMimeType(input.mimeType)) {
      return { status: "UNSUPPORTED", pages: [], limitations: [], error: `Document AI OCR does not support ${input.mimeType}.` };
    }
    if (input.buffer.length > MAX_INLINE_BYTES) {
      return { status: "UNSUPPORTED", pages: [], limitations: [], error: "File exceeds the online OCR size limit; batch OCR is not implemented yet." };
    }
    const response = await this.transport(this.endpoint(), {
      rawDocument: { content: input.buffer.toString("base64"), mimeType: input.mimeType },
      skipHumanReview: true,
    });
    return parseDocumentAiResponse(response);
  }
}

/** Maps a Document AI `ProcessResponse` to an OcrResult. Exported for tests. */
export function parseDocumentAiResponse(response: any): OcrResult {
  const document = response?.document;
  const fullText: string = typeof document?.text === "string" ? document.text : "";
  const rawPages: any[] = Array.isArray(document?.pages) ? document.pages : [];

  const sliceAnchor = (anchor: any): string =>
    (anchor?.textSegments ?? [])
      .map((s: any) => fullText.slice(Number(s.startIndex ?? 0), Number(s.endIndex ?? 0)))
      .join("");

  let pages: OcrPage[] = rawPages.map((p, i) => ({
    pageNumber: Number(p.pageNumber ?? i + 1),
    text: sliceAnchor(p.layout?.textAnchor),
    confidence: typeof p.layout?.confidence === "number" ? p.layout.confidence : undefined,
  }));
  if (pages.length === 0 && fullText) pages = [{ pageNumber: 1, text: fullText }];

  const languages = rawPages.flatMap((p) => p.detectedLanguages ?? []).filter((l: any) => l?.languageCode);
  languages.sort((a: any, b: any) => (b.confidence ?? 0) - (a.confidence ?? 0));

  return { pages, language: languages[0]?.languageCode, ...summarizePages(pages) };
}
