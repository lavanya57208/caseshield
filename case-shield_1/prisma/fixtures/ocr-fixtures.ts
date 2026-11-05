/**
 * FICTIONAL "scanned" documents for the Phase 4 demo and tests.
 *
 * The development MockOCRProvider does not recognize pixels. These builders
 * produce real, valid PNG / JPEG / image-only PDF files that additionally
 * carry an explicit OCR fixture layer (see
 * backend/src/modules/ai/ocr/mock-ocr.provider.ts) describing the text a
 * real OCR engine would read. The PDFs have NO text layer, so the pipeline
 * must take the OCR path for them. All names, numbers and places are
 * fictional.
 */
import zlib from "zlib";
import { PDFDocument, PDFName, PDFString, rgb } from "pdf-lib";
import { OCR_FIXTURE_KEY, OcrFixturePayload, encodeOcrFixture } from "../../backend/src/modules/ai/ocr/mock-ocr.provider";

export function scannedFirText(caseNumber = "CASE-2024-00042") {
  return [
    "FIRST INFORMATION REPORT (Under Section 154 Cr.P.C.)",
    "Police Station: Demo Nagar Police Station, Fictional District",
    "FIR No. 0421/2024  Date: 12/03/2024",
    `Case Reference: ${caseNumber}`,
    "The complainant reported that a two-wheeler was stolen from the parking area of Example Market.",
    "Complainant contact: complainant.demo@example.org",
    "Investigating Officer: SI Demo Kumar",
  ].join("\n");
}

export function scannedWitnessText(caseNumber = "CASE-2024-00042", evidenceNumber = "EVD-2024-00007") {
  return [
    "WITNESS STATEMENT",
    `Statement of witness recorded on 14/03/2024 in ${caseNumber}.`,
    "I saw a person in a grey jacket near the parking area at about 9 pm.",
    `Evidence reference: ${evidenceNumber}`,
  ].join("\n");
}

// --- PNG ---------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

/** A small grey 8-bit greyscale PNG. With `payload`, it carries the OCR fixture layer. */
export function buildScannedPng(payload?: OcrFixturePayload, width = 64, height = 32): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // greyscale
  const raw = Buffer.alloc((width + 1) * height, 0xdd);
  for (let y = 0; y < height; y++) raw[y * (width + 1)] = 0; // filter byte: none
  const chunks = [pngChunk("IHDR", ihdr)];
  if (payload) chunks.push(pngChunk("tEXt", Buffer.concat([Buffer.from(OCR_FIXTURE_KEY, "latin1"), Buffer.from([0]), Buffer.from(encodeOcrFixture(payload), "latin1")])));
  chunks.push(pngChunk("IDAT", zlib.deflateSync(raw)), pngChunk("IEND", Buffer.alloc(0)));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ...chunks]);
}

// --- JPEG --------------------------------------------------------------------

/**
 * A structurally minimal JPEG (SOI, COM, EOI). It is enough for signature
 * validation and the mock OCR fixture reader; it is not a decodable photo.
 */
export function buildScannedJpeg(payload?: OcrFixturePayload): Buffer {
  const parts: Buffer[] = [Buffer.from([0xff, 0xd8])];
  if (payload) {
    const body = Buffer.from(`${OCR_FIXTURE_KEY}:${encodeOcrFixture(payload)}`, "latin1");
    const header = Buffer.from([0xff, 0xfe, 0, 0]);
    header.writeUInt16BE(body.length + 2, 2);
    parts.push(header, body);
  }
  parts.push(Buffer.from([0xff, 0xd9]));
  return Buffer.concat(parts);
}

// --- Image-only ("scanned") PDF ---------------------------------------------

/** A PDF with no text layer (only drawn shapes). With `payload`, it carries the OCR fixture layer. */
export async function buildScannedPdf(payload?: OcrFixturePayload, pageCount = payload?.pages.length ?? 1): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    const page = doc.addPage([595, 842]);
    // Grey "scan lines" standing in for the raster image of a paper page.
    for (let y = 760; y > 120; y -= 18) page.drawRectangle({ x: 60, y, width: 470, height: 6, color: rgb(0.8, 0.8, 0.8) });
  }
  if (payload) (doc as any).getInfoDict().set(PDFName.of(OCR_FIXTURE_KEY), PDFString.of(encodeOcrFixture(payload)));
  return Buffer.from(await doc.save());
}
