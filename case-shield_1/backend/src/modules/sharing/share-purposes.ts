// Purpose-based sharing vocabulary. Purpose records WHY a document is being
// shared; it is an attribute of the share and is printed on watermarks and
// recorded in audit events. It never replaces authorization.
export const SHARE_PURPOSES = [
  "INVESTIGATION",
  "FORENSIC_EXAMINATION",
  "COURT_FILING",
  "LEGAL_REVIEW",
  "EVIDENCE_VERIFICATION",
  "ADMINISTRATIVE_REVIEW",
  "OTHER",
] as const;
export type SharePurposeKey = (typeof SHARE_PURPOSES)[number];

export const SHARE_PURPOSE_LABELS: Record<SharePurposeKey, string> = {
  INVESTIGATION: "Investigation",
  FORENSIC_EXAMINATION: "Forensic Examination",
  COURT_FILING: "Court Filing",
  LEGAL_REVIEW: "Legal Review",
  EVIDENCE_VERIFICATION: "Evidence Verification",
  ADMINISTRATIVE_REVIEW: "Administrative Review",
  OTHER: "Other",
};

export function purposeLabel(purpose: SharePurposeKey, note?: string | null): string {
  return purpose === "OTHER" && note ? `Other - ${note}` : SHARE_PURPOSE_LABELS[purpose];
}
