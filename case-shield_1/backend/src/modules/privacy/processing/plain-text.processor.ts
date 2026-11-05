import { ExtractionResult } from "@/modules/privacy/extraction/text-extraction";
import { PII_TYPE_LABELS } from "@/modules/privacy/pii/pii.types";
import { applyPdfWatermark, renderTextToPdf } from "@/modules/privacy/processing/pdf.processor";
import {
  DocumentProcessor,
  ProcessorOutput,
  RedactionSpan,
  UnsupportedProcessingError,
  WatermarkSpec,
} from "@/modules/privacy/processing/processor.types";

// Plain-text processor. Redaction rewrites the text with each selected span
// replaced by a "[REDACTED: <type>]" token — the removed characters do not
// exist anywhere in the output. Watermarking renders the text onto PDF
// pages (plain text cannot carry a visible watermark) and overlays the
// standard watermark, so the watermarked derivative is application/pdf.
export class PlainTextProcessor implements DocumentProcessor {
  readonly name = "plain-text-processor-v1";
  readonly capabilities = { redaction: true, watermark: true };

  async redact(input: { buffer: Buffer; extraction: ExtractionResult; spans: RedactionSpan[] }): Promise<ProcessorOutput> {
    const page = input.extraction.pages[0];
    if (!input.extraction.supported || !page) {
      throw new UnsupportedProcessingError(input.extraction.unsupportedReason ?? "Text could not be read.");
    }
    const spans = [...input.spans].filter((s) => s.pageNumber === 1).sort((a, b) => a.start - b.start);
    let out = "";
    let cursor = 0;
    for (const s of spans) {
      if (s.end <= cursor) continue;
      const from = Math.max(s.start, cursor);
      out += page.text.slice(cursor, from) + `[REDACTED: ${PII_TYPE_LABELS[s.type]}]`;
      cursor = s.end;
    }
    out += page.text.slice(cursor);
    return {
      buffer: Buffer.from(out, "utf-8"),
      mimeType: "text/plain",
      fileExtension: "txt",
      notes: [],
      method: "text-token-replacement",
    };
  }

  async watermark(input: { buffer: Buffer; spec: WatermarkSpec }): Promise<ProcessorOutput> {
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(input.buffer);
    } catch {
      throw new UnsupportedProcessingError("The text file is not valid UTF-8.");
    }
    const rendered = await renderTextToPdf(text, `${input.spec.documentNumber} (watermarked copy)`);
    const { buffer, notes } = await applyPdfWatermark(rendered, input.spec);
    return {
      buffer,
      mimeType: "application/pdf",
      fileExtension: "pdf",
      notes: ["Plain-text source rendered to PDF so the watermark is visible; characters outside the PDF standard font set appear as '?'.", ...notes],
      method: "text-render+pdf-overlay-watermark",
    };
  }
}
