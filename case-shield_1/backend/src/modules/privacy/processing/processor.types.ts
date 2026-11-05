import { ExtractionResult } from "@/modules/privacy/extraction/text-extraction";
import { PiiType } from "@/modules/privacy/pii/pii.types";

// Document derivative processing abstraction. Each processor declares which
// operations it can perform SAFELY for its format; a format with no
// processor (or an operation a processor cannot do safely) yields an
// UnsupportedProcessingError and the original stays untouched.

export interface RedactionSpan {
  pageNumber: number;
  start: number;
  end: number;
  type: PiiType;
}

export interface WatermarkSpec {
  classification: string;
  caseNumber: string;
  documentNumber: string;
  recipient: string;
  purpose: string;
  accessedAt: Date;
  /** Short reference printed on every page, traceable to the derivative row. */
  copyReference: string;
}

export interface ProcessorOutput {
  buffer: Buffer;
  mimeType: string;
  fileExtension: string;
  /** Human-readable notes on fidelity/limitations of the produced copy. */
  notes: string[];
  method: string;
}

export interface DocumentProcessor {
  readonly name: string;
  readonly capabilities: { redaction: boolean; watermark: boolean };
  redact(input: { buffer: Buffer; extraction: ExtractionResult; spans: RedactionSpan[] }): Promise<ProcessorOutput>;
  watermark(input: { buffer: Buffer; spec: WatermarkSpec }): Promise<ProcessorOutput>;
}

export class UnsupportedProcessingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedProcessingError";
  }
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatWatermarkDate(date: Date): string {
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = MONTHS[date.getUTCMonth()];
  const time = `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
  return `${day} ${month} ${date.getUTCFullYear()} ${time} UTC`;
}

export function watermarkLines(spec: WatermarkSpec): string[] {
  return [
    spec.classification,
    `Case ID: ${spec.caseNumber}`,
    `Recipient: ${spec.recipient}`,
    `Purpose: ${spec.purpose}`,
    `Accessed: ${formatWatermarkDate(spec.accessedAt)}`,
    `Document ID: ${spec.documentNumber}`,
    `Copy ref: ${spec.copyReference}`,
  ];
}
