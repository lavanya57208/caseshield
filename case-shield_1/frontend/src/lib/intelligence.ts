import { StructuredDocumentMetadata } from "@/types";

// Display vocabulary for Phase 4 document intelligence. Mirrors
// DOCUMENT_CLASSIFICATION_TYPES in backend/src/modules/ai/ai-provider.types.ts.
export const CLASSIFICATION_TYPES = [
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

export const CLASSIFICATION_LABELS: Record<string, string> = {
  FIR: "FIR",
  POLICE_REPORT: "Police report",
  WITNESS_STATEMENT: "Witness statement",
  CHARGE_SHEET: "Charge sheet",
  COURT_FILING: "Court filing",
  FORENSIC_REPORT: "Forensic report",
  LEGAL_NOTICE: "Legal notice",
  JUDGMENT: "Judgment / order",
  EVIDENCE_RECORD: "Evidence record",
  INVESTIGATION_RECORD: "Investigation record",
  OTHER: "Other / unclassified",
};

/** Types that can also be recorded as the document's own type (backend DocumentTypeEnum). */
export const APPLICABLE_DOCUMENT_TYPES = new Set(CLASSIFICATION_TYPES.filter((t) => t !== "OTHER"));

export const typeLabel = (t?: string | null) => (t ? CLASSIFICATION_LABELS[t] ?? t.replace(/_/g, " ").toLowerCase() : "—");

/** Editable scalar/list metadata fields (parties/identifiers are read-only suggestions). */
export const EDITABLE_METADATA_FIELDS: { key: keyof StructuredDocumentMetadata; label: string; kind: "text" | "date" | "list" }[] = [
  { key: "caseNumber", label: "Case number", kind: "text" },
  { key: "documentDate", label: "Document date", kind: "date" },
  { key: "documentTitle", label: "Title", kind: "text" },
  { key: "author", label: "Author / officer", kind: "text" },
  { key: "department", label: "Department / station", kind: "text" },
  { key: "evidenceIds", label: "Evidence IDs", kind: "list" },
  { key: "tags", label: "Tags", kind: "list" },
];

export function formatMetadataValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) {
    return value.map((v) => (typeof v === "object" && v ? Object.values(v as Record<string, string>).join(": ") : String(v))).join(", ");
  }
  return String(value);
}

export const percent = (c?: number | null) => (typeof c === "number" ? `${Math.round(c * 100)}%` : "—");

export const confidenceTone = (c?: number | null) => (typeof c !== "number" ? "text-ink-subtle" : c >= 0.75 ? "text-success" : c >= 0.5 ? "text-warning" : "text-danger");

/** Splits a server snippet ("…[[match]]…") into plain/highlighted parts — rendered as text, never as HTML. */
export function snippetParts(snippet: string): { text: string; match: boolean }[] {
  const parts: { text: string; match: boolean }[] = [];
  const re = /\[\[(.*?)\]\]/g;
  let last = 0;
  for (const m of snippet.matchAll(re)) {
    if (m.index! > last) parts.push({ text: snippet.slice(last, m.index), match: false });
    parts.push({ text: m[1], match: true });
    last = m.index! + m[0].length;
  }
  if (last < snippet.length) parts.push({ text: snippet.slice(last), match: false });
  return parts;
}
