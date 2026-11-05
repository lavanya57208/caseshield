import { CheckCircle2, Clock, ShieldAlert, AlertTriangle, XCircle, Info, Lock } from "lucide-react";
import clsx from "clsx";

// Central status vocabulary — see docs/product-requirements.md §"Security
// Visual Language". Color communicates status but every badge also carries
// an icon + text label, so status is never conveyed by color alone
// (accessibility requirement, docs/product-requirements.md §41).
export type BadgeTone = "success" | "warning" | "danger" | "neutral" | "info";

const TONE_STYLES: Record<BadgeTone, string> = {
  success: "bg-success-bg text-success border-success/20",
  warning: "bg-warning-bg text-warning border-warning/20",
  danger: "bg-danger-bg text-danger border-danger/20",
  neutral: "bg-navy-50 text-navy-600 border-navy-100",
  info: "bg-teal/10 text-teal-dark border-teal/20",
};

const STATUS_CONFIG: Record<string, { tone: BadgeTone; icon: typeof CheckCircle2; label?: string }> = {
  VERIFIED: { tone: "success", icon: CheckCircle2 },
  ACTIVE: { tone: "success", icon: CheckCircle2 },
  APPROVED: { tone: "success", icon: CheckCircle2 },
  SUCCESS: { tone: "success", icon: CheckCircle2 },
  COMPLETED: { tone: "success", icon: CheckCircle2 },

  PENDING: { tone: "warning", icon: Clock },
  UNDER_REVIEW: { tone: "warning", icon: Clock },
  ON_HOLD: { tone: "warning", icon: Clock },
  IN_TRANSIT: { tone: "warning", icon: Clock },
  UNVERIFIED: { tone: "warning", icon: AlertTriangle },

  // Evidence lifecycle (Phase 3)
  REGISTERED: { tone: "info", icon: Info },
  IN_CUSTODY: { tone: "success", icon: CheckCircle2, label: "In Custody" },
  UNDER_EXAMINATION: { tone: "info", icon: Clock, label: "Under Examination" },
  TRANSFERRED: { tone: "warning", icon: Clock, label: "Pending Receipt" },
  SUBMITTED_TO_COURT: { tone: "success", icon: CheckCircle2, label: "Submitted to Court" },
  RETURNED: { tone: "neutral", icon: Info },
  SEALED: { tone: "neutral", icon: Lock },

  RESTRICTED: { tone: "neutral", icon: Lock },
  HIGHLY_CONFIDENTIAL: { tone: "neutral", icon: Lock },
  CONFIDENTIAL: { tone: "neutral", icon: Lock },
  INTERNAL: { tone: "neutral", icon: Info },
  PUBLIC: { tone: "neutral", icon: Info },

  // Document intelligence (Phase 4)
  QUEUED: { tone: "warning", icon: Clock },
  PROCESSING: { tone: "info", icon: Clock },
  PARTIAL: { tone: "warning", icon: AlertTriangle },
  FAILED: { tone: "danger", icon: XCircle },
  SKIPPED: { tone: "neutral", icon: Info },
  UNSUPPORTED: { tone: "neutral", icon: Info },
  TEXT_EXTRACTED: { tone: "success", icon: CheckCircle2, label: "Text extracted" },
  OCR_PROCESSED: { tone: "success", icon: CheckCircle2, label: "OCR processed" },
  PENDING_REVIEW: { tone: "warning", icon: Clock, label: "Pending review" },
  CONFIRMED: { tone: "success", icon: CheckCircle2 },
  AI_GENERATED: { tone: "info", icon: Info, label: "AI generated" },
  AI_ASSISTED: { tone: "info", icon: CheckCircle2, label: "AI assisted · human corrected" },
  HUMAN_CONFIRMED: { tone: "success", icon: CheckCircle2, label: "Human confirmed" },

  EXPIRED: { tone: "danger", icon: XCircle },
  REVOKED: { tone: "danger", icon: XCircle },
  REJECTED: { tone: "danger", icon: XCircle },
  DENIED: { tone: "danger", icon: XCircle },
  VIOLATION: { tone: "danger", icon: ShieldAlert },
  ERROR: { tone: "danger", icon: ShieldAlert },
  CLOSED: { tone: "neutral", icon: CheckCircle2 },
  ARCHIVED: { tone: "neutral", icon: Info },
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const config: { tone: BadgeTone; icon: typeof CheckCircle2; label?: string } = STATUS_CONFIG[status] ?? { tone: "neutral", icon: Info };
  const Icon = config.icon;
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        TONE_STYLES[config.tone],
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {label ?? config.label ?? status.replace(/_/g, " ")}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: string }) {
  const tone: BadgeTone = priority === "CRITICAL" ? "danger" : priority === "HIGH" ? "warning" : priority === "MEDIUM" ? "info" : "neutral";
  return (
    <span className={clsx("inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold uppercase tracking-wide", TONE_STYLES[tone])}>
      {priority}
    </span>
  );
}
