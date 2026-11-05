import {
  ArrowRightLeft,
  Archive,
  CheckCircle2,
  Eye,
  FileCheck2,
  Gavel,
  LucideIcon,
  Microscope,
  PackageCheck,
  PackageOpen,
  PackagePlus,
  PackageX,
  ShieldCheck,
  Undo2,
  Lock,
  Unlock,
  XCircle,
} from "lucide-react";
import { CustodyAction, EvidenceStatus, EvidenceType } from "@/types";
import type { BadgeTone } from "@/components/StatusBadge";

// Display vocabulary for evidence. Mirrors backend
// modules/evidence/evidence.schemas.ts (types) and evidence-lifecycle.ts
// (statuses). Labels only — the backend decides what is allowed.

export const EVIDENCE_TYPE_LABELS: Record<EvidenceType, string> = {
  DOCUMENT: "Document",
  PHOTOGRAPH: "Photograph",
  VIDEO: "Video",
  AUDIO: "Audio",
  FORENSIC_REPORT: "Forensic Report",
  DIGITAL_EVIDENCE: "Digital Evidence",
  PHYSICAL_EVIDENCE: "Physical Evidence",
  DEVICE: "Device",
  BIOLOGICAL_SAMPLE: "Biological Sample",
  OTHER: "Other",
};

export const EVIDENCE_TYPES = Object.keys(EVIDENCE_TYPE_LABELS) as EvidenceType[];

export const EVIDENCE_STATUS_LABELS: Record<EvidenceStatus, string> = {
  REGISTERED: "Registered",
  IN_CUSTODY: "In Custody",
  UNDER_EXAMINATION: "Under Examination",
  TRANSFERRED: "Pending Receipt",
  SUBMITTED_TO_COURT: "Submitted to Court",
  RETURNED: "Returned",
  SEALED: "Sealed",
  ARCHIVED: "Archived",
};

export const CUSTODY_ACTION_META: Record<CustodyAction, { label: string; icon: LucideIcon; tone: BadgeTone }> = {
  COLLECTED: { label: "Collected", icon: PackagePlus, tone: "neutral" },
  REGISTERED: { label: "Evidence Registered", icon: PackagePlus, tone: "info" },
  TRANSFERRED: { label: "Transfer Initiated", icon: ArrowRightLeft, tone: "warning" },
  RECEIVED: { label: "Received", icon: PackageCheck, tone: "success" },
  TRANSFER_REJECTED: { label: "Transfer Rejected", icon: PackageX, tone: "danger" },
  TRANSFER_CANCELLED: { label: "Transfer Cancelled", icon: XCircle, tone: "neutral" },
  EXAMINED: { label: "Examined", icon: Microscope, tone: "info" },
  SEALED: { label: "Sealed", icon: Lock, tone: "neutral" },
  UNSEALED: { label: "Unsealed", icon: Unlock, tone: "neutral" },
  SUBMITTED: { label: "Submitted to Court", icon: Gavel, tone: "success" },
  RETURNED: { label: "Returned from Court", icon: Undo2, tone: "neutral" },
  ARCHIVED: { label: "Archived", icon: Archive, tone: "neutral" },
  VIEWED: { label: "Record Accessed", icon: Eye, tone: "neutral" },
  VERIFIED: { label: "Integrity Verification", icon: ShieldCheck, tone: "success" },
};

/** Actions recorded via POST /evidence/:id/actions, with their dialog copy. */
export const DIRECT_ACTIONS = {
  EXAMINE: { action: "EXAMINED", label: "Record examination", icon: Microscope, reasonPlaceholder: "e.g. Photographic comparison examination" },
  SEAL: { action: "SEALED", label: "Seal evidence", icon: Lock, reasonPlaceholder: "e.g. Sealed in evidence bag SB-0042" },
  UNSEAL: { action: "UNSEALED", label: "Unseal evidence", icon: Unlock, reasonPlaceholder: "e.g. Opened for laboratory examination" },
  SUBMIT: { action: "SUBMITTED", label: "Submit to court", icon: Gavel, reasonPlaceholder: "e.g. Filed with the trial court" },
  RETURN: { action: "RETURNED", label: "Record return from court", icon: Undo2, reasonPlaceholder: "e.g. Returned after hearing" },
  ARCHIVE: { action: "ARCHIVED", label: "Archive evidence", icon: Archive, reasonPlaceholder: "e.g. Case closed; retained per policy" },
} as const;
export type DirectUiAction = keyof typeof DIRECT_ACTIONS;

export const INTEGRITY_ICON = { VERIFIED: CheckCircle2, VIOLATION: XCircle, UNVERIFIED: FileCheck2, NONE: PackageOpen };
