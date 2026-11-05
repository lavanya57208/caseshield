// Text extraction for PII scanning and redaction. Only formats with a
// reliable text layer are supported; anything else (images, scanned PDFs,
// Office files) returns `supported: false` or `textLayer: false` so callers
// never report "no PII found" for content they could not read. OCR is a
// future provider (see docs/security-architecture.md §PII Protection).

export interface PositionedTextItem {
  str: string;
  /** Offset of `str` within the page text. */
  textStart: number;
  /** Baseline origin in PDF user space, relative to the page's lower-left corner. */
  x: number;
  y: number;
  fontSize: number;
  width: number;
  rotated: boolean;
}

export interface ExtractedPage {
  pageNumber: number;
  text: string;
  width?: number;
  height?: number;
  items?: PositionedTextItem[];
  hasImages?: boolean;
  hasVectorGraphics?: boolean;
}

export interface ExtractionResult {
  supported: boolean;
  textLayer: boolean;
  pages: ExtractedPage[];
  limitations: string[];
  unsupportedReason?: string;
}

export const SUPPORTED_EXTRACTION_MIME_TYPES = new Set(["application/pdf", "text/plain"]);

export async function extractText(buffer: Buffer, mimeType: string): Promise<ExtractionResult> {
  if (mimeType === "text/plain") return extractPlainText(buffer);
  if (mimeType === "application/pdf") return extractPdfText(buffer);
  return {
    supported: false,
    textLayer: false,
    pages: [],
    limitations: [],
    unsupportedReason: `Text extraction is not implemented for ${mimeType}. OCR / Office extraction is a future provider.`,
  };
}

function extractPlainText(buffer: Buffer): ExtractionResult {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return {
      supported: false,
      textLayer: false,
      pages: [],
      limitations: [],
      unsupportedReason: "The text file is not valid UTF-8.",
    };
  }
  return {
    supported: true,
    textLayer: text.trim().length > 0,
    pages: [{ pageNumber: 1, text }],
    limitations: [],
  };
}

type PdfJs = typeof import("pdfjs-dist");
let pdfjsPromise: Promise<PdfJs> | undefined;

// pdfjs-dist's legacy (CommonJS) build runs in Node without a worker. It
// prints canvas-polyfill warnings at load time that are irrelevant for text
// extraction (we never render), so they are silenced for that one import.
async function loadPdfJs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const originalLog = console.log;
      const originalWarn = console.warn;
      console.log = () => undefined;
      console.warn = () => undefined;
      try {
        const mod: any = await import("pdfjs-dist/legacy/build/pdf.js");
        return (mod.default ?? mod) as PdfJs;
      } finally {
        console.log = originalLog;
        console.warn = originalWarn;
      }
    })();
  }
  return pdfjsPromise;
}

export async function extractPdfText(buffer: Buffer): Promise<ExtractionResult> {
  const pdfjs = await loadPdfJs();
  let doc: any;
  try {
    doc = await pdfjs.getDocument({
      data: new Uint8Array(buffer),
      disableWorker: true,
      isEvalSupported: false,
      useSystemFonts: false,
      disableFontFace: true,
      verbosity: 0,
    } as any).promise;
  } catch (err: any) {
    const reason =
      err?.name === "PasswordException"
        ? "The PDF is encrypted / password-protected and cannot be processed."
        : "The PDF could not be parsed.";
    return { supported: false, textLayer: false, pages: [], limitations: [], unsupportedReason: reason };
  }

  const imageOps = new Set<number>(
    [pdfjs.OPS.paintImageXObject, pdfjs.OPS.paintInlineImageXObject, pdfjs.OPS.paintImageMaskXObject, pdfjs.OPS.paintImageXObjectRepeat].filter(
      (op): op is number => typeof op === "number",
    ),
  );
  const pathOps = new Set<number>([pdfjs.OPS.constructPath, pdfjs.OPS.rectangle].filter((op): op is number => typeof op === "number"));

  const pages: ExtractedPage[] = [];
  let anyRotated = false;
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const [x0, y0, x1, y1] = page.view as number[];
      const content = await page.getTextContent();
      const ops = await page.getOperatorList();
      const fnArray: number[] = ops.fnArray;

      let text = "";
      const items: PositionedTextItem[] = [];
      let prev: PositionedTextItem | undefined;
      let prevEol = false;

      for (const raw of content.items as any[]) {
        if (typeof raw.str !== "string") continue;
        const [a, b, c, d, e, f] = raw.transform as number[];
        const fontSize = Math.hypot(c, d) || Math.hypot(a, b) || 10;
        const rotated = Math.abs(b) > 1e-3 || Math.abs(c) > 1e-3;
        anyRotated ||= rotated;
        const item: PositionedTextItem = {
          str: raw.str,
          textStart: 0,
          x: e - x0,
          y: f - y0,
          fontSize,
          width: raw.width ?? 0,
          rotated,
        };

        if (raw.str.length > 0 && prev && !prevEol && text.length > 0 && !/\s$/.test(text)) {
          const sameLine = Math.abs(item.y - prev.y) < Math.max(prev.fontSize, item.fontSize) * 0.5;
          if (!sameLine) text += "\n";
          else if (item.x > prev.x + prev.width + fontSize * 0.1 && !/^\s/.test(raw.str)) text += " ";
        }

        item.textStart = text.length;
        text += raw.str;
        if (raw.str.length > 0) {
          items.push(item);
          prev = item;
        }
        prevEol = !!raw.hasEOL;
        if (raw.hasEOL) text += "\n";
      }

      pages.push({
        pageNumber: n,
        text,
        width: x1 - x0,
        height: y1 - y0,
        items,
        hasImages: fnArray.some((op) => imageOps.has(op)),
        hasVectorGraphics: fnArray.some((op) => pathOps.has(op)),
      });
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }

  const textLayer = pages.some((p) => p.text.trim().length > 0);
  const limitations: string[] = [];
  if (!textLayer) {
    limitations.push("No extractable text layer (likely a scanned/image-only PDF). OCR is not implemented, so PII in images was NOT scanned.");
  } else if (pages.some((p) => p.hasImages)) {
    limitations.push("The PDF contains images. Text inside images is not scanned (OCR not implemented).");
  }
  if (anyRotated) limitations.push("Some text is rotated; positions are approximate.");

  return { supported: true, textLayer, pages, limitations };
}
