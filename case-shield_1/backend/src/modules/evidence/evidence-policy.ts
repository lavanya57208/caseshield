import { canTransition, EvidenceStatus } from "./evidence-lifecycle";

// Per-item evidence policy. Pure: the service resolves the user's EFFECTIVE
// permissions on the case (role baseline + case grants + confidentiality,
// via lib/authorization.ts#can) and passes them in; this module layers on
// the custody rules — who holds the item, pending transfers, lifecycle.
// Both the API enforcement and the `allowedActions` list returned to the UI
// come from here, so the UI can never offer an action the server refuses.

export type EvidencePermission =
  | "evidence.view"
  | "evidence.transfer"
  | "evidence.receive"
  | "evidence.examine"
  | "evidence.seal"
  | "evidence.submit"
  | "evidence.archive"
  | "evidence.verify"
  | "audit.view";

export type EvidenceUiAction =
  | "VIEW"
  | "TRANSFER"
  | "ACCEPT_TRANSFER"
  | "REJECT_TRANSFER"
  | "CANCEL_TRANSFER"
  | "EXAMINE"
  | "SEAL"
  | "UNSEAL"
  | "SUBMIT"
  | "RETURN"
  | "ARCHIVE"
  | "VERIFY_INTEGRITY"
  | "VERIFY_CUSTODY"
  | "VIEW_AUDIT";

export interface EvidenceForPolicy {
  status: EvidenceStatus;
  currentCustodianId: string | null;
  originalVersionId: string | null;
  submittedAt: Date | null;
}

export interface PendingTransferForPolicy {
  toCustodianId: string;
  initiatedById: string;
  previousStatus: EvidenceStatus;
}

/** Roles whose evidence visibility is limited to items submitted to court. */
const COURT_ROLES = new Set(["JUDGE"]);
/** Roles that grant evidence.view by baseline (mirrors lib/permissions.ts). */
const EVIDENCE_VIEW_ROLES = new Set(["INVESTIGATOR", "SENIOR_INVESTIGATOR", "FORENSIC_OFFICER", "PROSECUTOR", "JUDGE", "AUDITOR"]);

/**
 * A court-only viewer (e.g. a Judge with no investigative role) may see an
 * evidence item only once it has been submitted to court. An explicit case
 * grant of evidence.view lifts the restriction.
 */
export function isCourtOnlyViewer(roles: string[], hasExplicitEvidenceViewGrant: boolean): boolean {
  if (hasExplicitEvidenceViewGrant) return false;
  const viewRoles = roles.filter((r) => EVIDENCE_VIEW_ROLES.has(r));
  return viewRoles.length > 0 && viewRoles.every((r) => COURT_ROLES.has(r));
}

export function canViewEvidence(
  evidence: Pick<EvidenceForPolicy, "submittedAt">,
  perms: Set<EvidencePermission>,
  courtOnly: boolean,
): boolean {
  if (!perms.has("evidence.view")) return false;
  if (courtOnly && !evidence.submittedAt) return false;
  return true;
}

export function allowedEvidenceActions(
  evidence: EvidenceForPolicy,
  userId: string,
  perms: Set<EvidencePermission>,
  courtOnly: boolean,
  pending: PendingTransferForPolicy | null,
): EvidenceUiAction[] {
  if (!canViewEvidence(evidence, perms, courtOnly)) return [];
  const actions: EvidenceUiAction[] = ["VIEW"];
  const isCustodian = evidence.currentCustodianId === userId;
  const s = evidence.status;

  if (pending) {
    if (pending.toCustodianId === userId && perms.has("evidence.receive")) actions.push("ACCEPT_TRANSFER", "REJECT_TRANSFER");
    if (pending.initiatedById === userId) actions.push("CANCEL_TRANSFER");
  } else if (isCustodian) {
    if (perms.has("evidence.transfer") && canTransition(s, "TRANSFERRED")) actions.push("TRANSFER");
    if (perms.has("evidence.examine") && canTransition(s, "EXAMINED")) actions.push("EXAMINE");
    if (perms.has("evidence.seal") && canTransition(s, "SEALED")) actions.push("SEAL");
    if (perms.has("evidence.seal") && canTransition(s, "UNSEALED")) actions.push("UNSEAL");
    if (perms.has("evidence.submit") && canTransition(s, "SUBMITTED")) actions.push("SUBMIT");
    if (perms.has("evidence.submit") && canTransition(s, "RETURNED")) actions.push("RETURN");
  }
  // Archiving is a supervisory lifecycle decision, not a custody hand-over,
  // so it does not require holding the item — but never mid-transfer.
  if (!pending && perms.has("evidence.archive") && canTransition(s, "ARCHIVED")) actions.push("ARCHIVE");

  if (perms.has("evidence.verify")) {
    if (evidence.originalVersionId) actions.push("VERIFY_INTEGRITY");
    actions.push("VERIFY_CUSTODY");
  }
  if (perms.has("audit.view")) actions.push("VIEW_AUDIT");
  return actions;
}

// --- Transfer target validation ---------------------------------------------

export type TransferDenialCode =
  | "REASON_REQUIRED"
  | "SAME_CUSTODIAN"
  | "RECIPIENT_NOT_FOUND"
  | "RECIPIENT_INACTIVE"
  | "RECIPIENT_OTHER_ORGANIZATION"
  | "RECIPIENT_NO_CASE_ACCESS"
  | "RECIPIENT_NOT_AUTHORIZED";

export interface TransferTargetInput {
  reason: string;
  currentCustodianId: string | null;
  organizationId: string;
  recipient: { id: string; status: string; organizationId: string; deletedAt: Date | null } | null;
  recipientHasCaseAccess: boolean;
  /** evidence.receive on this case (incl. confidentiality) AND evidence.view on this item. */
  recipientCanReceive: boolean;
}

export function validateTransferTarget(input: TransferTargetInput): { ok: true } | { ok: false; code: TransferDenialCode; message: string } {
  const deny = (code: TransferDenialCode, message: string) => ({ ok: false as const, code, message });
  if (!input.reason || input.reason.trim().length < 3) return deny("REASON_REQUIRED", "A reason for the transfer is required.");
  const r = input.recipient;
  if (!r) return deny("RECIPIENT_NOT_FOUND", "The selected recipient does not exist.");
  if (r.id === input.currentCustodianId) return deny("SAME_CUSTODIAN", "The recipient is already the current custodian.");
  if (r.organizationId !== input.organizationId) return deny("RECIPIENT_OTHER_ORGANIZATION", "The recipient belongs to a different organization.");
  if (r.status !== "ACTIVE" || r.deletedAt) return deny("RECIPIENT_INACTIVE", "The recipient's account is not active.");
  if (!input.recipientHasCaseAccess) return deny("RECIPIENT_NO_CASE_ACCESS", "The recipient is not part of this case.");
  if (!input.recipientCanReceive) return deny("RECIPIENT_NOT_AUTHORIZED", "The recipient is not authorized to receive this evidence.");
  return { ok: true };
}
