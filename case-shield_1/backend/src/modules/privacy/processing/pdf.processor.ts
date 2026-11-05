import { PDFDocument, PDFFont, PDFPage, StandardFonts, degrees, rgb } from "pdf-lib";
import { extractPdfText } from "@/modules/privacy/extraction/text-extraction";
import {
  DocumentProcessor,
  ProcessorOutput,
  RedactionSpan,
  UnsupportedProcessingError,
  WatermarkSpec,
  formatWatermarkDate,
} from "@/modules/privacy/processing/processor.types";
import { ExtractionResult } from "@/modules/privacy/extraction/text-extraction";

// PDF processor.
//
// REDACTION — reconstruction, not overlay. Drawing black boxes on top of
// the original page leaves the sensitive text in the content stream (it
// can still be selected, copied, or extracted). Instead, the redacted copy
// is a NEW PDF built only from the extracted text items: redacted
// characters are never written to it at all, and a black box marks where
// they were. Nothing from the original file's content streams, fonts,
// annotations, metadata, attachments or images is copied over. Trade-off:
// layout is approximate (fonts normalised to Helvetica) and images/vector
// graphics are omitted — both recorded in the derivative's notes.
// Scanned PDFs (no text layer) are UNSUPPORTED rather than "redacted".
//
// WATERMARK — overlay on a copy loaded from the source bytes; the source
// object in storage is never written to.

function makeSanitizer(font: PDFFont) {
  const supported = new Set(font.getCharacterSet());
  return (text: string) =>
    Array.from(text.replace(/[\r\n\t]/g, " "))
      .map((ch) => (supported.has(ch.codePointAt(0)!) ? ch : "?"))
      .join("");
}

interface Segment {
  text: string;
  redacted: boolean;
}

function mergeSpans(spans: { start: number; end: number }[]) {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const s of sorted) {
    const last = merged[merged.length - 1];
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else merged.push({ ...s });
  }
  return merged;
}

function segmentItem(str: string, itemStart: number, spans: { start: number; end: number }[]): Segment[] {
  const itemEnd = itemStart + str.length;
  const segments: Segment[] = [];
  let cursor = itemStart;
  for (const s of spans) {
    if (s.end <= cursor || s.start >= itemEnd) continue;
    const from = Math.max(s.start, cursor);
    const to = Math.min(s.end, itemEnd);
    if (from > cursor) segments.push({ text: str.slice(cursor - itemStart, from - itemStart), redacted: false });
    segments.push({ text: str.slice(from - itemStart, to - itemStart), redacted: true });
    cursor = to;
  }
  if (cursor < itemEnd) segments.push({ text: str.slice(cursor - itemStart), redacted: false });
  return segments;
}

function fitText(text: string, font: PDFFont, size: number, maxWidth: number): { text: string; size: number } {
  let s = size;
  while (s > 5 && font.widthOfTextAtSize(text, s) > maxWidth) s -= 0.5;
  let t = text;
  while (t.length > 4 && font.widthOfTextAtSize(t, s) > maxWidth) t = `${t.slice(0, -2)}…`.replace(/……$/, "…");
  return { text: t, size: s };
}

export async function applyPdfWatermark(source: Buffer, spec: WatermarkSpec): Promise<{ buffer: Buffer; notes: string[] }> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(source, { updateMetadata: false });
  } catch (err: any) {
    if (err?.constructor?.name === "EncryptedPDFError" || /encrypt/i.test(String(err?.message))) {
      throw new UnsupportedProcessingError("The PDF is encrypted; a watermarked copy cannot be produced safely.");
    }
    throw new UnsupportedProcessingError("The PDF could not be parsed for watermarking.");
  }

  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const clean = makeSanitizer(regular);
  const notes: string[] = [];

  const diagonal = clean(`${spec.classification} · ${spec.recipient} · ${spec.purpose}`);
  const footer = [
    clean(`${spec.classification}  ·  Case ID: ${spec.caseNumber}  ·  Document ID: ${spec.documentNumber}`),
    clean(`Recipient: ${spec.recipient}  ·  Purpose: ${spec.purpose}`),
    clean(`Accessed: ${formatWatermarkDate(spec.accessedAt)}  ·  Copy ref: ${spec.copyReference}`),
  ];

  let rotatedPages = 0;
  for (const page of doc.getPages()) {
    if (page.getRotation().angle % 360 !== 0) rotatedPages++;
    drawWatermark(page, { bold, regular, diagonal, footer });
  }
  if (rotatedPages > 0) notes.push(`${rotatedPages} page(s) use page rotation; the watermark may appear rotated on them.`);

  doc.setSubject(`Case Shield watermarked copy ${spec.copyReference}`);
  doc.setKeywords(["Case Shield", "watermarked", spec.caseNumber, spec.documentNumber, spec.copyReference]);
  doc.setProducer("Case Shield");
  doc.setModificationDate(spec.accessedAt);

  return { buffer: Buffer.from(await doc.save()), notes };
}

function drawWatermark(
  page: PDFPage,
  opts: { bold: PDFFont; regular: PDFFont; diagonal: string; footer: string[] },
) {
  const { width, height } = page.getSize();

  // Large, light diagonal banner across the page centre — clearly visible
  // but translucent so the underlying text stays readable.
  const angle = Math.atan2(height, width);
  const diagonalLength = Math.hypot(width, height) * 0.8;
  const fitted = fitText(opts.diagonal, opts.bold, Math.min(width, height) / 12, diagonalLength);
  const textWidth = opts.bold.widthOfTextAtSize(fitted.text, fitted.size);
  const cx = width / 2;
  const cy = height / 2;
  page.drawText(fitted.text, {
    x: cx - (textWidth / 2) * Math.cos(angle) + (fitted.size / 3) * Math.sin(angle),
    y: cy - (textWidth / 2) * Math.sin(angle) - (fitted.size / 3) * Math.cos(angle),
    size: fitted.size,
    font: opts.bold,
    color: rgb(0.62, 0.1, 0.1),
    opacity: 0.14,
    rotate: degrees((angle * 180) / Math.PI),
  });

  // Attribution footer on every page.
  const lineHeight = 9;
  const bandHeight = opts.footer.length * lineHeight + 8;
  page.drawRectangle({ x: 0, y: 0, width, height: bandHeight, color: rgb(1, 1, 1), opacity: 0.82 });
  page.drawLine({ start: { x: 18, y: bandHeight }, end: { x: width - 18, y: bandHeight }, thickness: 0.5, color: rgb(0.62, 0.1, 0.1), opacity: 0.6 });
  opts.footer.forEach((line, i) => {
    const font = i === 0 ? opts.bold : opts.regular;
    const f = fitText(line, font, 7, width - 36);
    page.drawText(f.text, {
      x: 18,
      y: bandHeight - (i + 1) * lineHeight,
      size: f.size,
      font,
      color: i === 0 ? rgb(0.62, 0.1, 0.1) : rgb(0.15, 0.2, 0.25),
    });
  });
}

/** Renders plain text onto fresh A4 pages (used to watermark text documents). */
export async function renderTextToPdf(text: string, title: string): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const clean = makeSanitizer(font);
  const [pageWidth, pageHeight] = [595.28, 841.89];
  const margin = 54;
  const size = 10;
  const leading = 14;
  const maxWidth = pageWidth - margin * 2;
  const bottom = margin + 40; // leave room for the watermark footer band

  const lines: string[] = [];
  for (const rawLine of text.replace(/\r\n/g, "\n").split("\n")) {
    const words = clean(rawLine).split(/(\s+)/);
    let current = "";
    for (const word of words) {
      const candidate = current + word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        current = candidate;
        continue;
      }
      if (current.trim()) lines.push(current.trimEnd());
      current = word.trimStart();
      while (font.widthOfTextAtSize(current, size) > maxWidth) {
        let cut = current.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(current.slice(0, cut), size) > maxWidth) cut--;
        lines.push(current.slice(0, cut));
        current = current.slice(cut);
      }
    }
    lines.push(current.trimEnd());
  }

  let page = doc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;
  for (const line of lines) {
    if (y < bottom) {
      page = doc.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
    }
    if (line) page.drawText(line, { x: margin, y, size, font, color: rgb(0.08, 0.1, 0.14) });
    y -= leading;
  }
  doc.setTitle(clean(title));
  doc.setProducer("Case Shield");
  return Buffer.from(await doc.save());
}

export class PdfProcessor implements DocumentProcessor {
  readonly name = "pdf-processor-v1";
  readonly capabilities = { redaction: true, watermark: true };

  async redact(input: { buffer: Buffer; extraction: ExtractionResult; spans: RedactionSpan[] }): Promise<ProcessorOutput> {
    const { extraction, spans } = input;
    if (!extraction.supported) throw new UnsupportedProcessingError(extraction.unsupportedReason ?? "PDF not supported.");
    if (!extraction.textLayer) {
      throw new UnsupportedProcessingError(
        "This PDF has no extractable text layer (likely scanned). Safe redaction requires OCR, which is not implemented.",
      );
    }

    const out = await PDFDocument.create();
    const font = await out.embedFont(StandardFonts.Helvetica);
    const clean = makeSanitizer(font);
    const notes = [
      "Redacted copy is a text reconstruction: fonts are normalised and layout is approximate. No content streams from the original were copied.",
    ];
    const pagesWithImages: number[] = [];
    const pagesWithGraphics: number[] = [];
    let rotatedItems = 0;

    for (const page of extraction.pages) {
      const pdfPage = out.addPage([page.width ?? 595.28, page.height ?? 841.89]);
      const pageSpans = mergeSpans(spans.filter((s) => s.pageNumber === page.pageNumber));
      if (page.hasImages) pagesWithImages.push(page.pageNumber);
      if (page.hasVectorGraphics) pagesWithGraphics.push(page.pageNumber);

      for (const item of page.items ?? []) {
        if (item.rotated) rotatedItems++;
        const size = Math.min(Math.max(item.fontSize, 4), 72);
        let x = item.x;
        for (const seg of segmentItem(item.str, item.textStart, pageSpans)) {
          const safe = clean(seg.text);
          const w = font.widthOfTextAtSize(safe, size);
          if (seg.redacted) {
            pdfPage.drawRectangle({
              x,
              y: item.y - size * 0.25,
              width: Math.max(w, size * 0.6),
              height: size * 1.1,
              color: rgb(0, 0, 0),
            });
          } else if (safe.trim().length > 0) {
            pdfPage.drawText(safe, { x, y: item.y, size, font, color: rgb(0, 0, 0) });
          }
          x += w;
        }
      }

      pdfPage.drawText("Case Shield redacted derivative - reconstructed text; original images and graphics are not included.", {
        x: 18,
        y: 8,
        size: 5.5,
        font,
        color: rgb(0.45, 0.45, 0.45),
      });
    }

    if (pagesWithImages.length) notes.push(`Images on page(s) ${pagesWithImages.join(", ")} were omitted (not scanned or reproduced).`);
    if (pagesWithGraphics.length) notes.push(`Lines/shapes on page(s) ${pagesWithGraphics.join(", ")} were omitted.`);
    if (rotatedItems) notes.push("Rotated text was re-drawn horizontally.");

    out.setTitle("Redacted copy");
    out.setProducer("Case Shield");
    out.setCreator("Case Shield redaction service");
    return {
      buffer: Buffer.from(await out.save()),
      mimeType: "application/pdf",
      fileExtension: "pdf",
      notes,
      method: "pdf-text-reconstruction",
    };
  }

  async watermark(input: { buffer: Buffer; spec: WatermarkSpec }): Promise<ProcessorOutput> {
    const { buffer, notes } = await applyPdfWatermark(input.buffer, input.spec);
    return { buffer, mimeType: "application/pdf", fileExtension: "pdf", notes, method: "pdf-overlay-watermark" };
  }
}

/** Re-extracts text from a produced PDF — used to verify redaction output. */
export async function extractPdfPlainText(buffer: Buffer): Promise<string[]> {
  const result = await extractPdfText(buffer);
  return result.pages.map((p) => p.text);
}
