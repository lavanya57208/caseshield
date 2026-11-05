import { RoleKey } from "@/types";

// Frontend mirror of backend/src/lib/permissions.ts — used ONLY to decide
// what to show/hide for a smoother UX (e.g. hiding a Download button a user
// can't use). This is never the source of authorization truth: every
// action is re-checked server-side regardless of what this returns. See
// docs/security-architecture.md §"Frontend Architecture".
export const ROLE_BASELINE_PERMISSIONS: Record<RoleKey, string[]> = {
  INVESTIGATOR: [
    "case.view", "document.view", "document.upload", "document.download", "document.version",
    "document.verify", "document.scan", "document.redact", "evidence.view", "evidence.register", "evidence.transfer",
    "evidence.receive", "evidence.seal", "evidence.verify", "access.request", "ai.process",
  ],
  SENIOR_INVESTIGATOR: [
    "case.view", "case.create", "case.update", "case.assign", "document.view", "document.upload",
    "document.download", "document.share", "document.version", "document.verify", "document.scan", "document.redact", "evidence.view",
    "evidence.register", "evidence.transfer", "evidence.receive", "evidence.seal", "evidence.submit", "evidence.archive",
    "evidence.verify", "access.request", "access.approve", "audit.view", "ai.process",
  ],
  FORENSIC_OFFICER: [
    "case.view", "document.view", "document.upload", "document.download", "document.version",
    "document.verify", "document.scan", "document.redact", "evidence.view", "evidence.register", "evidence.transfer",
    "evidence.receive", "evidence.examine", "evidence.seal", "evidence.verify", "access.request", "ai.process",
  ],
  PROSECUTOR: [
    "case.view", "document.view", "document.download", "document.verify", "evidence.view", "evidence.transfer",
    "evidence.receive", "evidence.submit", "evidence.verify", "access.request", "ai.process",
  ],
  JUDGE: ["case.view", "document.view", "document.verify", "evidence.view", "evidence.verify", "audit.view"],
  LAWYER: ["case.view", "document.view", "access.request"],
  COURT_STAFF: ["case.view", "document.view", "document.download", "access.request"],
  AUTHORIZED_PARTY: ["access.request"],
  AUDITOR: ["case.view", "document.view", "evidence.view", "evidence.verify", "audit.view"],
  ADMIN: ["case.view", "case.create", "case.update", "case.assign", "document.view", "audit.view", "access.approve", "access.revoke", "admin.manage"],
};

export function roleHasPermission(roles: RoleKey[], permission: string): boolean {
  return roles.some((role) => ROLE_BASELINE_PERMISSIONS[role]?.includes(permission));
}
