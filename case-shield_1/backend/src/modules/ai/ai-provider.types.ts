// AIProvider — see docs/ai-architecture.md, docs/architecture.md §8 and
// docs/security-architecture.md §11. AI assists document processing; it never
// bypasses authorization and never determines legal outcomes. Every returned
// field is attributable and user-correctable (results are stored as
// AI_GENERATED suggestions and only become authoritative after human review).
//
// Callers (ai.service / document pipeline / search) are responsible for:
//   - authorizing the user BEFORE any provider call,
//   - excluding RESTRICTED material by policy,
//   - passing only PII-MASKED text (see privacy/pii maskPiiInText).
// Providers therefore never see raw PII values or unauthorized documents.

/** Classification taxonomy (Phase 4). "OTHER" when nothing fits confidently. */
export const DOCUMENT_CLASSIFICATION_TYPES = [
  "FIR",
  "POLICE_REPORT",
  "WITNESS_STATEMENT",
  "CHARGE_SHEET",
  "COURT_FILING",
  "FORENSIC_REPORT",
  "LEGAL_NOTICE",
  "JUDGMENT",
  "EVIDENCE_RECORD",
  "INVESTIGATION_RECORD",
  "OTHER",
] as const;
export type DocumentClassificationType = (typeof DOCUMENT_CLASSIFICATION_TYPES)[number];

export interface ExtractedField {
  label: string;
  value: string;
  confidence: number; // 0..1
}

/** One extracted metadata value. `value: null` means "not found / unknown" — never guessed. */
export interface MetadataValue<T = string> {
  value: T | null;
  confidence: number; // 0..1; 0 when value is null
}

export interface StructuredDocumentMetadata {
  caseNumber: MetadataValue;
  documentDate: MetadataValue; // ISO yyyy-mm-dd when recognized
  documentTitle: MetadataValue;
  documentType: MetadataValue<DocumentClassificationType>;
  author: MetadataValue;
  department: MetadataValue;
  evidenceIds: MetadataValue<string[]>;
  parties: MetadataValue<{ role: string; name: string }[]>;
  identifiers: MetadataValue<{ label: string; value: string }[]>;
  tags: MetadataValue<string[]>;
}

export interface MetadataExtractionResult {
  documentType?: string;
  suggestedCaseNumber?: string;
  /** Legacy flat view (pre-Phase 4 UI). */
  entities: ExtractedField[];
  /** Phase 4 structured fields. */
  fields?: StructuredDocumentMetadata;
  extractedAt: string;
}

export interface ClassificationResult {
  suggestedType: string;
  confidence: number;
  /** Short, content-free explanation (e.g. matched cue names). */
  rationale?: string;
}

export interface SummaryResult {
  summary: string;
}

/** Structured reading of a free-text search query. Never widens authorization. */
export interface SearchQueryInterpretation {
  keywords: string[];
  documentTypes: DocumentClassificationType[];
  caseNumbers: string[];
  evidenceNumbers: string[];
  dateFrom?: string;
  dateTo?: string;
}

export interface RankCandidate {
  id: string;
  /** Title plus (PII-masked) summary/metadata of an AUTHORIZED document. */
  text: string;
}

export interface AIProvider {
  readonly name: string;
  extractMetadata(input: { fileName: string; mimeType: string; textSample: string }): Promise<MetadataExtractionResult>;
  classifyDocument(input: { fileName: string; textSample: string }): Promise<ClassificationResult>;
  summarizeDocument(input: { textSample: string }): Promise<SummaryResult>;
  semanticSearch(input: { query: string; candidateTitles: string[] }): Promise<number[]>; // relevance scores aligned to candidateTitles
  /** Phase 4: interpret a query into keywords/filters. Receives the query only — no documents. */
  interpretSearchQuery(input: { query: string }): Promise<SearchQueryInterpretation>;
}
