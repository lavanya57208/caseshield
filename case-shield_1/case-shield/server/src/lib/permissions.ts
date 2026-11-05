import { db } from "../db";

/**
 * Case Shield authorization model
 * ---------------------------------------------------------------------------
 *   Person -> Role -> Case -> Document -> Permission -> Action
 *
 * Every privileged route calls `can()` server-side before touching data.
 * Nothing in this system relies on hiding a button in the UI - the same
 * check runs whether the request came from the web app or curl.
 *
 * Layers, evaluated in order:
 *   1. Role defaults      (role_permissions table - seeded, coarse-grained)
 *   2. Case membership     (case_stakeholders / assigned_investigator / creator)
 *   3. Resource sensitivity (a document's confidentiality_level can require
 *                            an explicit grant even for an otherwise-allowed role)
 *   4. Explicit grants      (document_permissions rows, created when an
 *                            access request is approved - can expire)
 *
 * System Administrator is deliberately NOT given blanket document-content
 * access: admins can manage accounts, categories and roles, but reading case
 * document content still requires case membership or an explicit grant, same
 * as anyone else. Auditors get broad read access to audit trails, not to
 * document content, unless separately granted.
 */

export const ROLES = [
  "Investigator",
  "Senior Investigator",
  "Forensic Officer",
  "Prosecutor",
  "Judge",
  "Lawyer",
  "Court Staff",
  "Litigant",
  "System Administrator",
  "Auditor",
] as const;
export type Role = (typeof ROLES)[number];

export type ResourceType = "case" | "document" | "evidence" | "custody" | "access_request" | "audit" | "system";
export type Action =
  | "view"
  | "download"
  | "upload"
  | "edit_metadata"
  | "verify_integrity"
  | "approve"
  | "manage"
  | "create"
  | "revoke";

export interface AuthUser {
  id: string;
  name: string;
  role: Role;
  department?: string;
}

function roleDefaultAllows(role: Role, resourceType: ResourceType, action: Action): boolean {
  const row = db
    .prepare(
      `SELECT 1 FROM role_permissions WHERE role = ? AND resource_type = ? AND action = ? AND effect = 'ALLOW'`
    )
    .get(role, resourceType, action);
  return !!row;
}

function isCaseMember(userId: string, caseId: string): boolean {
  const row = db
    .prepare(
      `SELECT 1 FROM cases WHERE id = ? AND (assigned_investigator_id = ? OR created_by = ?)
       UNION
       SELECT 1 FROM case_stakeholders WHERE case_id = ? AND user_id = ?`
    )
    .get(caseId, userId, userId, caseId, userId);
  return !!row;
}

function hasExplicitDocumentGrant(userId: string, documentId: string, action: Action): boolean {
  const row = db
    .prepare(
      `SELECT 1 FROM document_permissions
       WHERE document_id = ? AND user_id = ? AND permission = ?
         AND (expires_at IS NULL OR expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))`
    )
    .get(documentId, userId, actionToPermissionLabel(action));
  return !!row;
}

function actionToPermissionLabel(action: Action): string {
  const map: Record<Action, string> = {
    view: "View",
    download: "Download",
    upload: "Upload",
    edit_metadata: "Edit Metadata",
    verify_integrity: "Verify Integrity",
    approve: "Approve",
    manage: "Manage",
    create: "Create",
    revoke: "Revoke",
  };
  return map[action];
}

export interface PermissionContext {
  caseId?: string;
  documentId?: string;
  evidenceId?: string;
}

export interface PermissionResult {
  allow: boolean;
  reason: string;
}

export function can(
  user: AuthUser,
  action: Action,
  resourceType: ResourceType,
  ctx: PermissionContext = {}
): PermissionResult {
  // System-wide resources (user/category management, global audit log)
  if (resourceType === "system") {
    const allow = roleDefaultAllows(user.role, "system", action);
    return { allow, reason: allow ? "role default" : "role has no system-level grant" };
  }

  if (resourceType === "audit") {
    const allow = roleDefaultAllows(user.role, "audit", action);
    return { allow, reason: allow ? "role default" : "role has no audit-log grant" };
  }

  if (resourceType === "access_request") {
    const allow = roleDefaultAllows(user.role, "access_request", action);
    return { allow, reason: allow ? "role default" : "role has no access-request grant" };
  }

  // Case-scoped resources below: case, document, evidence, custody
  const roleAllows = roleDefaultAllows(user.role, resourceType, action);

  if (ctx.caseId) {
    const member = isCaseMember(user.id, ctx.caseId);

    if (resourceType === "document" && ctx.documentId) {
      const doc = db
        .prepare("SELECT confidentiality_level, uploaded_by FROM documents WHERE id = ?")
        .get(ctx.documentId) as { confidentiality_level: string; uploaded_by: string } | undefined;

      const explicitGrant = hasExplicitDocumentGrant(user.id, ctx.documentId, action);
      const isUploader = doc?.uploaded_by === user.id;

      if (doc?.confidentiality_level === "Restricted") {
        // Restricted documents always require an explicit, approved access
        // grant (or being the original uploader) - case membership alone is
        // not enough, even for senior roles.
        const allow = explicitGrant || isUploader;
        return {
          allow: !!allow,
          reason: allow
            ? explicitGrant
              ? "explicit access grant"
              : "document uploader"
            : "Restricted document requires an approved access request",
        };
      }

      const allow = roleAllows && (member || explicitGrant);
      return {
        allow,
        reason: allow ? (member ? "case member + role default" : "explicit access grant") : "not a case member and no explicit grant",
      };
    }

    const allow = roleAllows && member;
    return { allow, reason: allow ? "case member + role default" : "role default present but user is not a member of this case" };
  }

  // No case context supplied - fall back to pure role default (used for
  // top-level listings that are themselves filtered down to authorized cases).
  return { allow: roleAllows, reason: roleAllows ? "role default" : "role has no default grant for this action" };
}

/** Returns the set of case IDs a user is authorized to view - used to scope list/search endpoints. */
export function authorizedCaseIds(user: AuthUser): string[] | "ALL" {
  if (user.role === "System Administrator" || user.role === "Auditor") {
    // Admin/Auditor can see that a case exists (for audit + account admin
    // purposes) but that does NOT imply document-content access - that is
    // still checked per-document above.
    return "ALL";
  }
  const rows = db
    .prepare(
      `SELECT id FROM cases WHERE assigned_investigator_id = ? OR created_by = ?
       UNION
       SELECT case_id as id FROM case_stakeholders WHERE user_id = ?`
    )
    .all(user.id, user.id, user.id) as { id: string }[];
  return rows.map((r) => r.id);
}
