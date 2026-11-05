import { describe, it, expect } from "vitest";
import { PDFDocument, rgb } from "pdf-lib";
import { sha256 } from "../../backend/src/lib/hash";
import { extractText } from "../../backend/src/modules/privacy/extraction/text-extraction";
import { DeterministicPiiDetectionProvider } from "../../backend/src/modules/privacy/pii/deterministic-pii.provider";
import { getDocumentProcessor, UnsupportedProcessingError, WatermarkSpec } from "../../backend/src/modules/privacy/processing";
import { extractPdfPlainText } from "../../backend/src/modules/privacy/processing/pdf.processor";
import { buildFictionalContactSheetPdf, fictionalContactSheetLines, FICTIONAL_PII, RAW_PII_VALUES } from "../../prisma/fixtures/fictional-pii-document";

const provider = new DeterministicPiiDetectionProvider();

const spec: WatermarkSpec = {
  classification: "CONFIDENTIAL",
  caseNumber: "CASE-2026-00427",
  documentNumber: "DOC-2026-001844",
  recipient: "Prosecutor Office (Adv. Demo Prosecutor)",
  purpose: "Court Filing",
  accessedAt: new Date("2026-09-25T09:30:00Z"),
  copyReference: "ABCD1234",
};

async function redactAll(buffer: Buffer, mimeType: string) {
  const extraction = await extractText(buffer, mimeType);
  const detections = await provider.detect(extraction.pages);
  const processor = getDocumentProcessor(mimeType)!;
  const output = await processor.redact({
    buffer,
    extraction,
    spans: detections.map((d) => ({ pageNumber: d.pageNumber, start: d.start, end: d.end, type: d.type })),
  });
  return { output, detections };
}

describe("PDF redaction (reconstruction)", () => {
  it("produces a new PDF whose text layer contains none of the redacted values, leaving the source untouched", async () => {
    const original = await buildFictionalContactSheetPdf("CASE-2026-00427");
    const before = sha256(original);

    const { output, detections } = await redactAll(original, "application/pdf");
    expect(detections.length).toBeGreaterThanOrEqual(6);
    expect(output.mimeType).toBe("application/pdf");
    expect(sha256(output.buffer)).not.toBe(before);

    const text = (await extractPdfPlainText(output.buffer)).join("\n");
    for (const raw of RAW_PII_VALUES) expect(text).not.toContain(raw);
    // Non-sensitive content survives.
    expect(text).toContain("FICTIONAL COMPLAINANT CONTACT SHEET");
    expect(text).toContain("Aadhaar No:");

    // No selectable text is hidden under the boxes: re-scanning finds nothing.
    const residual = provider.detectSync((await extractPdfPlainText(output.buffer)).map((t, i) => ({ pageNumber: i + 1, text: t })));
    expect(residual).toHaveLength(0);

    expect(sha256(original)).toBe(before);
  });

  it("refuses (UNSUPPORTED) to 'redact' a PDF with no text layer instead of pretending", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([300, 300]).drawRectangle({ x: 20, y: 20, width: 100, height: 60, color: rgb(0.2, 0.2, 0.2) });
    const scannedLike = Buffer.from(await doc.save());
    const extraction = await extractText(scannedLike, "application/pdf");
    expect(extraction.textLayer).toBe(false);
    expect(extraction.limitations.join(" ")).toMatch(/OCR is not implemented/);
    await expect(
      getDocumentProcessor("application/pdf")!.redact({ buffer: scannedLike, extraction, spans: [] }),
    ).rejects.toBeInstanceOf(UnsupportedProcessingError);
  });

  it("reports an unparseable PDF as unsupported for extraction", async () => {
    const extraction = await extractText(Buffer.from("%PDF-1.4 not really a pdf"), "application/pdf");
    expect(extraction.supported).toBe(false);
  });
});

describe("plain-text redaction", () => {
  it("replaces redacted spans with tokens so the values do not exist in the output", async () => {
    const original = Buffer.from(fictionalContactSheetLines("CASE-2026-00427").join("\n"), "utf-8");
    const { output } = await redactAll(original, "text/plain");
    const text = output.buffer.toString("utf-8");
    for (const raw of RAW_PII_VALUES) expect(text).not.toContain(raw);
    expect(text).toContain("[REDACTED: Email address]");
    expect(text).toContain("Address: [REDACTED: Address-like information]");
  });
});

describe("watermarking", () => {
  it("creates a watermarked PDF copy carrying recipient, purpose, case and document IDs without modifying the source", async () => {
    const original = await buildFictionalContactSheetPdf("CASE-2026-00427");
    const snapshot = Buffer.from(original);
    const output = await getDocumentProcessor("application/pdf")!.watermark({ buffer: original, spec });

    expect(Buffer.compare(original, snapshot)).toBe(0);
    expect(sha256(output.buffer)).not.toBe(sha256(original));
    const text = (await extractPdfPlainText(output.buffer)).join("\n");
    expect(text).toContain("Recipient: Prosecutor Office (Adv. Demo Prosecutor)");
    expect(text).toContain("Purpose: Court Filing");
    expect(text).toContain("Case ID: CASE-2026-00427");
    expect(text).toContain("Document ID: DOC-2026-001844");
    expect(text).toContain("Accessed: 25 Sep 2026 09:30 UTC");
    // The original content remains readable underneath.
    expect(text).toContain("FICTIONAL COMPLAINANT CONTACT SHEET");
  });

  it("renders plain text to a watermarked PDF", async () => {
    const output = await getDocumentProcessor("text/plain")!.watermark({ buffer: Buffer.from("Fictional note.\nSecond line."), spec });
    expect(output.mimeType).toBe("application/pdf");
    const text = (await extractPdfPlainText(output.buffer)).join("\n");
    expect(text).toContain("Fictional note.");
    expect(text).toContain("Copy ref: ABCD1234");
  });

  it("combines redaction then watermarking without reintroducing redacted values", async () => {
    const original = await buildFictionalContactSheetPdf("CASE-2026-00427");
    const { output: redacted } = await redactAll(original, "application/pdf");
    const watermarked = await getDocumentProcessor("application/pdf")!.watermark({ buffer: redacted.buffer, spec });
    const text = (await extractPdfPlainText(watermarked.buffer)).join("\n");
    expect(text).not.toContain(FICTIONAL_PII.email);
    expect(text).toContain("Purpose: Court Filing");
  });
});

describe("processor registry", () => {
  it("returns no processor for formats that cannot be processed safely yet", () => {
    expect(getDocumentProcessor("image/png")).toBeNull();
    expect(getDocumentProcessor("application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBeNull();
  });
});
