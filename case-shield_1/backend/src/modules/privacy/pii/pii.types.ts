// PII detection provider abstraction — see docs/security-architecture.md
// §PII Protection. Business logic depends only on these types, so the
// deterministic rules engine can later be swapped for (or combined with)
// an AI/NLP provider without touching scanning, redaction, or the API.

export const PII_TYPES = ["AADHAAR_LIKE", "PHONE_NUMBER", "EMAIL_ADDRESS", "IP_ADDRESS", "ADDRESS_LIKE"] as const;
export type PiiType = (typeof PII_TYPES)[number];

export type PiiConfidence = "LOW" | "MEDIUM" | "HIGH";

/** How much a provider can be relied on for a given PII type. */
export type PiiCoverage = "PATTERN" | "HEURISTIC_LIMITED" | "NOT_SUPPORTED";

export interface PiiTextPage {
  pageNumber: number;
  text: string;
}

export interface PiiDetection {
  type: PiiType;
  confidence: PiiConfidence;
  pageNumber: number;
  /** Character offsets into the page text the detection ran on. */
  start: number;
  end: number;
  maskedPreview: string;
  detectionMethod: string;
  /**
   * Raw matched text and its normalized form. IN-MEMORY ONLY: used to
   * locate text for redaction and to compute a keyed fingerprint. Never
   * persisted, logged, returned by the API, or written to audit events.
   */
  value: string;
  normalized: string;
}

export interface PiiDetectionProvider {
  readonly name: string;
  readonly coverage: Record<PiiType, PiiCoverage>;
  detect(pages: PiiTextPage[]): Promise<PiiDetection[]>;
}

/**
 * Address detection is split out because simple rules cannot reliably find
 * postal addresses. The deterministic implementation is explicitly
 * `limited`; an NLP/NER-backed strategy can replace it later.
 */
export interface AddressDetectionStrategy {
  readonly name: string;
  readonly limited: boolean;
  detect(page: PiiTextPage): PiiDetection[];
}

export const PII_TYPE_LABELS: Record<PiiType, string> = {
  AADHAAR_LIKE: "Aadhaar-like number",
  PHONE_NUMBER: "Phone number",
  EMAIL_ADDRESS: "Email address",
  IP_ADDRESS: "IP address",
  ADDRESS_LIKE: "Address-like information",
};
