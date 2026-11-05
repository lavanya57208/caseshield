// Pure access policy for controlled shares. Kept free of I/O so the exact
// enforcement rules are unit-testable (tests/backend/share-policy.test.ts)
// and so every entry point (view, download, detail) evaluates the SAME
// rules server-side. The frontend never decides whether a share is usable.

export const MAX_SHARE_DURATION_DAYS = 90;
/** Tolerance for clock skew when a client sends startsAt ≈ "now". */
export const START_SKEW_MS = 5 * 60 * 1000;

export type ShareAccessMode = "view" | "download";

export type ShareDenialCode =
  | "NOT_RECIPIENT"
  | "TENANT_MISMATCH"
  | "SHARE_REVOKED"
  | "SHARE_REJECTED"
  | "SHARE_PENDING"
  | "SHARE_EXPIRED"
  | "SHARE_NOT_STARTED"
  | "DOWNLOAD_NOT_PERMITTED";

export interface ShareForPolicy {
  recipientUserId: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED" | "REVOKED";
  startsAt: Date;
  expiresAt: Date;
  allowDownload: boolean;
  revokedAt: Date | null;
  /** Organization that owns the shared document's case. */
  organizationId: string;
}

export type ShareDecision =
  | { allowed: true }
  | { allowed: false; code: ShareDenialCode; message: string; expiredTransition: boolean };

const deny = (code: ShareDenialCode, message: string, expiredTransition = false): ShareDecision => ({
  allowed: false,
  code,
  message,
  expiredTransition,
});

export function evaluateShareAccess(
  share: ShareForPolicy,
  user: { id: string; organizationId: string },
  mode: ShareAccessMode,
  now: Date = new Date(),
): ShareDecision {
  if (share.recipientUserId !== user.id) return deny("NOT_RECIPIENT", "You are not the recipient of this share.");
  if (share.organizationId !== user.organizationId) return deny("TENANT_MISMATCH", "This share is not available to your organization.");
  if (share.status === "REVOKED" || share.revokedAt) return deny("SHARE_REVOKED", "This share has been revoked.");
  if (share.status === "REJECTED") return deny("SHARE_REJECTED", "This share request was rejected.");
  if (share.status === "PENDING") return deny("SHARE_PENDING", "This share is awaiting approval.");
  if (share.status === "EXPIRED") return deny("SHARE_EXPIRED", "This share has expired.");
  if (now.getTime() >= share.expiresAt.getTime()) return deny("SHARE_EXPIRED", "This share has expired.", true);
  if (now.getTime() < share.startsAt.getTime()) return deny("SHARE_NOT_STARTED", "This share is not active yet.");
  if (mode === "download" && !share.allowDownload) {
    return deny("DOWNLOAD_NOT_PERMITTED", "Download is not permitted for this share. It is view-only.");
  }
  return { allowed: true };
}

/** Validates a requested access window. Returns an error message or null. */
export function validateShareWindow(startsAt: Date, expiresAt: Date, now: Date = new Date()): string | null {
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(expiresAt.getTime())) return "Invalid start or expiry date.";
  if (startsAt.getTime() < now.getTime() - START_SKEW_MS) return "The share cannot start in the past.";
  if (expiresAt.getTime() <= now.getTime()) return "The expiry must be in the future.";
  if (expiresAt.getTime() <= startsAt.getTime()) return "The expiry must be after the start time.";
  if (expiresAt.getTime() - startsAt.getTime() > MAX_SHARE_DURATION_DAYS * 24 * 60 * 60 * 1000) {
    return `A share can last at most ${MAX_SHARE_DURATION_DAYS} days.`;
  }
  return null;
}
