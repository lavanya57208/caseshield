// Evidence lifecycle state machine — the ONLY place that decides which
// custody action may follow which evidence status. Pure (no I/O) so it is
// unit-tested exhaustively (tests/backend/evidence-lifecycle.test.ts).
// The client never sends a status: it requests an action, and the server
// derives the next status from here.

export const EVIDENCE_STATUSES = [
  "REGISTERED",
  "IN_CUSTODY",
  "UNDER_EXAMINATION",
  "TRANSFERRED",
  "SUBMITTED_TO_COURT",
  "RETURNED",
  "SEALED",
  "ARCHIVED",
] as const;
export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];

export type LifecycleAction =
  | "TRANSFERRED" // transfer initiated (pending receipt)
  | "RECEIVED" // recipient accepted
  | "TRANSFER_REJECTED"
  | "TRANSFER_CANCELLED"
  | "EXAMINED"
  | "SEALED"
  | "UNSEALED"
  | "SUBMITTED"
  | "RETURNED"
  | "ARCHIVED"
  | "VIEWED"
  | "VERIFIED";

/** Actions a custodian (or authorized role) requests through POST /evidence/:id/actions. */
export const DIRECT_ACTIONS = ["EXAMINED", "SEALED", "UNSEALED", "SUBMITTED", "RETURNED", "ARCHIVED"] as const;
export type DirectAction = (typeof DIRECT_ACTIONS)[number];

/** Statuses in which the evidence is physically held by its current custodian. */
const HELD: EvidenceStatus[] = ["REGISTERED", "IN_CUSTODY", "UNDER_EXAMINATION", "SEALED", "RETURNED"];

const RULES: Record<Exclude<LifecycleAction, "RECEIVED" | "TRANSFER_REJECTED" | "TRANSFER_CANCELLED" | "VIEWED" | "VERIFIED">, { from: EvidenceStatus[]; to: EvidenceStatus }> = {
  // Sealed packages can be handed over without being opened.
  TRANSFERRED: { from: HELD, to: "TRANSFERRED" },
  // Examination requires an unsealed item; repeat examinations are allowed.
  EXAMINED: { from: ["REGISTERED", "IN_CUSTODY", "UNDER_EXAMINATION", "RETURNED"], to: "UNDER_EXAMINATION" },
  SEALED: { from: ["REGISTERED", "IN_CUSTODY", "UNDER_EXAMINATION", "RETURNED"], to: "SEALED" },
  UNSEALED: { from: ["SEALED"], to: "IN_CUSTODY" },
  SUBMITTED: { from: ["IN_CUSTODY", "SEALED", "UNDER_EXAMINATION", "RETURNED"], to: "SUBMITTED_TO_COURT" },
  RETURNED: { from: ["SUBMITTED_TO_COURT"], to: "RETURNED" },
  ARCHIVED: { from: ["IN_CUSTODY", "SEALED", "RETURNED"], to: "ARCHIVED" },
};

export class InvalidTransitionError extends Error {
  constructor(
    public readonly status: string,
    public readonly action: string,
  ) {
    super(`${humanize(action)} is not allowed while evidence is ${humanize(status)}.`);
  }
}

function humanize(v: string) {
  return v.replace(/_/g, " ").toLowerCase();
}

/**
 * Returns the status that results from `action` on evidence currently in
 * `status`, or throws InvalidTransitionError. `transferPreviousStatus` is
 * the status recorded on the pending transfer (needed for receipt /
 * rejection so a SEALED item stays SEALED through a hand-over).
 */
export function nextStatus(status: EvidenceStatus, action: LifecycleAction, transferPreviousStatus?: EvidenceStatus): EvidenceStatus {
  switch (action) {
    case "VIEWED":
    case "VERIFIED":
      return status; // access / verification never changes custody state
    case "RECEIVED":
      if (status !== "TRANSFERRED") throw new InvalidTransitionError(status, action);
      return transferPreviousStatus === "SEALED" ? "SEALED" : "IN_CUSTODY";
    case "TRANSFER_REJECTED":
    case "TRANSFER_CANCELLED":
      if (status !== "TRANSFERRED" || !transferPreviousStatus) throw new InvalidTransitionError(status, action);
      return transferPreviousStatus;
    default: {
      const rule = RULES[action];
      if (!rule || !rule.from.includes(status)) throw new InvalidTransitionError(status, action);
      return rule.to;
    }
  }
}

export function canTransition(status: EvidenceStatus, action: LifecycleAction, transferPreviousStatus?: EvidenceStatus): boolean {
  try {
    nextStatus(status, action, transferPreviousStatus);
    return true;
  } catch {
    return false;
  }
}

export function isTerminal(status: EvidenceStatus): boolean {
  return status === "ARCHIVED";
}
