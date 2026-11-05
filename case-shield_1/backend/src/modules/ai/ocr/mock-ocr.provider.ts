import { PDFDocument, PDFName, PDFString, PDFHexString } from "pdf-lib";
// Relative (not "@/") import: prisma/fixtures/ocr-fixtures.ts imports this
// module from the standalone seed script, where the path alias is unavailable.
import { OCRProvider, OcrInput, OcrPage, OcrResult, summarizePages } from "./ocr-provider.types";

// DEVELOPMENT ADAPTER — deterministic, offline, no OCR engine.
//
// It does NOT recognize text from pixels. It reads an explicit "OCR fixture
// layer" that test/demo files carry (see prisma/fixtures/ocr-fixtures.ts):
//   - PNG:  a tEXt chunk with keyword "CaseShieldOCR"
//   - JPEG: a COM segment starting with "CaseShieldOCR:"
//   - PDF:  an Info-dictionary entry /CaseShieldOCR
// holding base64(UTF-8 JSON { pages: [{ text, confidence? }], language? }).
// Any other image/scanned PDF returns FAILED with an explicit reason — the
// mock never claims OCR succeeded when it did not. Production uses Google
// Document AI behind the same OCRProvider interface.

export const OCR_FIXTURE_KEY = "CaseShieldOCR";

export interface OcrFixturePayload {
  pages: { text: string; confidence?: number }[];
  language?: string;
}

export function encodeOcrFixture(payload: OcrFixturePayload): string {
  return Buffer.from(JSON.stringify(payload), "utf-8").toString("base64");
}

function decodeOcrFixture(encoded: string): OcrFixturePayload | null {
  try {
    const parsed = JSON.parse(Buffer.from(encoded.trim(), "base64").toString("utf-8"));
    if (!parsed || !Array.isArray(parsed.pages)) return null;
    return {
      language: typeof parsed.language === "string" ? parsed.language : undefined,
      pages: parsed.pages
        .filter((p: any) => p && typeof p.text === "string")
        .map((p: any) => ({ text: p.text, confidence: typeof p.confidence === "number" ? p.confidence : undefined })),
    };
  } catch {
    return null;
  }
}

function readPngFixture(buf: Buffer): string | null {
  const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIG)) return null;
  let offset = 8;
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString("latin1", offset + 4, offset + 8);
    const dataStart = offset + 8;
    if (dataStart + length > buf.length) return null;
    if (type === "tEXt") {
      const data = buf.subarray(dataStart, dataStart + length);
      const nul = data.indexOf(0);
      if (nul > 0 && data.toString("latin1", 0, nul) === OCR_FIXTURE_KEY) return data.toString("latin1", nul + 1);
    }
    if (type === "IEND") break;
    offset = dataStart + length + 4; // skip CRC
  }
  return null;
}

function readJpegFixture(buf: Buffer): string | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 4 <= buf.length && buf[offset] === 0xff) {
    const marker = buf[offset + 1];
    if (marker === 0xda || marker === 0xd9) break; // start of scan / end of image
    const length = buf.readUInt16BE(offset + 2);
    if (marker === 0xfe) {
      const text = buf.toString("latin1", offset + 4, offset + 2 + length);
      if (text.startsWith(`${OCR_FIXTURE_KEY}:`)) return text.slice(OCR_FIXTURE_KEY.length + 1);
    }
    offset += 2 + length;
  }
  return null;
}

async function readPdfFixture(buf: Buffer): Promise<{ encoded: string | null; pageCount: number }> {
  try {
    const doc = await PDFDocument.load(buf, { updateMetadata: false, ignoreEncryption: false });
    const info = (doc as any).getInfoDict?.();
    const value = info?.lookup?.(PDFName.of(OCR_FIXTURE_KEY));
    const encoded = value instanceof PDFString || value instanceof PDFHexString ? value.decodeText() : null;
    return { encoded, pageCount: doc.getPageCount() };
  } catch {
    return { encoded: null, pageCount: 0 };
  }
}

export class MockOCRProvider implements OCRProvider {
  readonly external = false;

  providerName() {
    return "MockOCRProvider (development, reads embedded OCR fixture layer)";
  }

  supportsMimeType(mimeType: string) {
    return ["application/pdf", "image/png", "image/jpeg"].includes(mimeType);
  }

  async extractText(input: OcrInput): Promise<OcrResult> {
    if (!this.supportsMimeType(input.mimeType)) {
      return { status: "UNSUPPORTED", pages: [], limitations: [], error: `The mock OCR provider does not support ${input.mimeType}.` };
    }
    let encoded: string | null = null;
    let expectedPages = 0;
    if (input.mimeType === "image/png") encoded = readPngFixture(input.buffer);
    else if (input.mimeType === "image/jpeg") encoded = readJpegFixture(input.buffer);
    else {
      const pdf = await readPdfFixture(input.buffer);
      encoded = pdf.encoded;
      expectedPages = pdf.pageCount;
    }

    const simulated = "Mock OCR: text was read from an embedded fixture layer, not recognized from the image. Use Document AI in production.";
    const payload = encoded ? decodeOcrFixture(encoded) : null;
    if (!payload) {
      return {
        status: "FAILED",
        pages: [],
        limitations: [],
        error: "No text could be recognized: the mock OCR provider only reads embedded OCR fixture layers. Configure OCR_PROVIDER=document-ai for real OCR.",
      };
    }
    const pages: OcrPage[] = payload.pages.map((p, i) => ({ pageNumber: i + 1, text: p.text, confidence: p.confidence ?? 0.9 }));
    // A PDF with more pages than the fixture describes: the rest were not recognized.
    for (let n = pages.length + 1; n <= expectedPages; n++) pages.push({ pageNumber: n, text: "", confidence: 0 });
    return { pages, language: payload.language, ...summarizePages(pages, [simulated]) };
  }
}
