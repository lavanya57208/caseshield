import { FileImage, FileText, FileType2, LucideIcon } from "lucide-react";

const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  FIR: "FIR",
  POLICE_REPORT: "Police Report",
  INVESTIGATION_REPORT: "Investigation Report",
  INVESTIGATION_RECORD: "Investigation Record",
  WITNESS_STATEMENT: "Witness Statement",
  CHARGE_SHEET: "Charge Sheet",
  COURT_FILING: "Court Filing",
  EVIDENCE_RECORD: "Evidence Record",
  FORENSIC_REPORT: "Forensic Report",
  LEGAL_NOTICE: "Legal Notice",
  JUDGMENT: "Judgment",
  ORDER: "Order",
  SUPPORTING_DOCUMENT: "Supporting Document",
};

export const documentTypeLabel = (type?: string | null) =>
  type ? DOCUMENT_TYPE_LABELS[type] ?? type.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : "—";

export function fileIcon(mimeType?: string | null): LucideIcon {
  if (mimeType?.startsWith("image/")) return FileImage;
  if (mimeType?.includes("word")) return FileType2;
  return FileText;
}

export const PRIORITY_LABELS: Record<string, string> = { LOW: "Low", MEDIUM: "Medium", HIGH: "High", CRITICAL: "Critical" };

/** Previewable inline in the browser (served through the authenticated API as a blob). */
export const isPreviewable = (mimeType?: string | null) => !!mimeType && (mimeType === "application/pdf" || mimeType.startsWith("image/") || mimeType === "text/plain");
