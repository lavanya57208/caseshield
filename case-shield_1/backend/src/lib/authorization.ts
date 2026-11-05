import { prisma } from "@/lib/prisma";
import { AuthenticatedUser } from "@/middleware/auth";
import { PermissionKey, ROLE_BASELINE_PERMISSIONS } from "@/lib/permissions";

// Implements the authorization model from docs/product-requirements.md §4:
//
//   Person -> Role -> Organization -> Case -> Document -> Permission -> Action
//
// Authorization is evaluated fresh on every call — nothing here is cached
// across requests, so a revoked grant takes effect immediately. This is the
// ONLY place in the backend that should decide "is this allowed."

export type CaseAccessRecord = {
  id: string;
  organizationId: string;
  investigatingOfficerId: string | null;
  confidentiality: string;
};

export type DocumentAccessRecord = {
  id: string;
  caseId: string;
  confidentiality: string;
};

const OVERSIGHT_ROLES = new Set(["ADMIN", "AUDITOR", "JUDGE"]);

function roleBaselinePermissions(roles: string[]): Set<PermissionKey> {
  const perms = new Set<PermissionKey>();
  for (const role of roles) {
    for (const p of ROLE_BASELINE_PERMISSIONS[role] ?? []) {
      perms.add(p);
    }
  }
  return perms;
}

async function activeCasePermissionGrants(user: AuthenticatedUser, caseId: string) {
  return prisma.casePermission.findMany({
    where: {
      caseId,
      revokedAt: null,
      OR: [{ userId: user.id }, { roleId: { in: user.roleIds } }],
      AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }],
    },
    include: { permission: true },
  });
}

async function activeDocumentPermissionGrants(user: AuthenticatedUser, documentId: string) {
  return prisma.documentPermission.findMany({
    where: {
      documentId,
      revokedAt: null,
      userId: user.id,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    include: { permission: true },
  });
}

export async function hasCaseAccess(user: AuthenticatedUser, caseRecord: CaseAccessRecord): Promise<boolean> {
  if (caseRecord.organizationId !== user.organizationId) return false;
  if (user.roles.some((r) => OVERSIGHT_ROLES.has(r))) return true;
  if (caseRecord.investigatingOfficerId === user.id) return true;

  const assignment = await prisma.caseAssignment.findUnique({
    where: { caseId_userId: { caseId: caseRecord.id, userId: user.id } },
  });
  if (assignment) return true;

  const grants = await activeCasePermissionGrants(user, caseRecord.id);
  return grants.length > 0;
}

/**
 * Determines whether `user` may perform `permission` on the given case,
 * optionally scoped further to a specific document within it.
 *
 * A RESTRICTED or HIGHLY_CONFIDENTIAL document requires an explicit
 * case- or document-level grant — role baseline alone is not sufficient —
 * matching "a forensic officer may have different permissions from a
 * lawyer" / classification-aware access in docs/product-requirements.md §4.
 */
export type EvidenceAccessRecord = {
  confidentiality: string;
};

/**
 * Evidence is scoped exactly like a document: case access first, then the
 * permission, and RESTRICTED / HIGHLY_CONFIDENTIAL evidence additionally
 * needs an explicit case-level grant (or an oversight role). There is no
 * evidence-level grant table — grants for evidence are case grants.
 */
export async function can(
  user: AuthenticatedUser,
  permission: PermissionKey,
  options: { case: CaseAccessRecord; document?: DocumentAccessRecord; evidence?: EvidenceAccessRecord },
): Promise<{ allowed: boolean; reason?: string }> {
  const caseRecord = options.case;

  const caseAccess = await hasCaseAccess(user, caseRecord);
  if (!caseAccess) {
    return { allowed: false, reason: "No access to this case." };
  }

  const caseGrants = await activeCasePermissionGrants(user, caseRecord.id);
  const caseGrantKeys = new Set(caseGrants.map((g) => g.permission.key as PermissionKey));

  let documentGrantKeys = new Set<PermissionKey>();
  if (options.document) {
    const docGrants = await activeDocumentPermissionGrants(user, options.document.id);
    documentGrantKeys = new Set(docGrants.map((g) => g.permission.key as PermissionKey));
  }

  return decidePermission({
    roles: user.roles,
    permission,
    caseAccess,
    caseConfidentiality: caseRecord.confidentiality,
    documentConfidentiality: options.document?.confidentiality,
    evidenceConfidentiality: options.evidence?.confidentiality,
    caseGrantKeys,
    documentGrantKeys,
  });
}

/**
 * The pure decision rule behind can(). Both can() and the batched
 * authorizeDocuments() gather the same facts (case access, active grants)
 * and delegate here, so single-item and bulk (search) authorization can
 * never disagree.
 */
export function decidePermission(facts: {
  roles: string[];
  permission: PermissionKey;
  caseAccess: boolean;
  caseConfidentiality: string;
  documentConfidentiality?: string;
  evidenceConfidentiality?: string;
  caseGrantKeys: Set<PermissionKey>;
  documentGrantKeys: Set<PermissionKey>;
}): { allowed: boolean; reason?: string } {
  if (!facts.caseAccess) return { allowed: false, reason: "No access to this case." };

  const baseline = roleBaselinePermissions(facts.roles);
  const isHigh = (c?: string) => c === "RESTRICTED" || c === "HIGHLY_CONFIDENTIAL";
  const highSensitivity =
    isHigh(facts.documentConfidentiality) ||
    isHigh(facts.evidenceConfidentiality) ||
    // A document carries its own classification; evidence (or a bare case
    // check) inherits the case's classification as a floor.
    (facts.documentConfidentiality === undefined && isHigh(facts.caseConfidentiality));

  const explicitlyGranted = facts.caseGrantKeys.has(facts.permission) || facts.documentGrantKeys.has(facts.permission);

  if (highSensitivity) {
    const allowed = explicitlyGranted || (baseline.has(facts.permission) && facts.roles.some((r) => OVERSIGHT_ROLES.has(r)));
    return allowed
      ? { allowed: true }
      : { allowed: false, reason: "This resource requires an explicit access grant due to its confidentiality level." };
  }

  const allowed = baseline.has(facts.permission) || explicitlyGranted;
  return allowed ? { allowed: true } : { allowed: false, reason: "Your role does not include this permission." };
}

export type BulkDocumentRecord = DocumentAccessRecord & { case: CaseAccessRecord };

/**
 * Batched equivalent of calling can(user, p, { case, document }) for every
 * (document, permission) pair — used by search, where per-item calls would
 * cost several queries per candidate. Loads assignments and grants for all
 * candidates in three queries, then applies decidePermission(). Returns,
 * per document id, the subset of `permissions` the user holds on it.
 */
export async function authorizeDocuments(
  user: AuthenticatedUser,
  permissions: PermissionKey[],
  docs: BulkDocumentRecord[],
): Promise<Map<string, Set<PermissionKey>>> {
  const result = new Map<string, Set<PermissionKey>>();
  if (docs.length === 0) return result;

  const caseIds = [...new Set(docs.map((d) => d.case.id))];
  const docIds = docs.map((d) => d.id);
  const now = new Date();
  const [assignments, caseGrants, docGrants] = await Promise.all([
    prisma.caseAssignment.findMany({ where: { userId: user.id, caseId: { in: caseIds } }, select: { caseId: true } }),
    prisma.casePermission.findMany({
      where: {
        caseId: { in: caseIds },
        revokedAt: null,
        OR: [{ userId: user.id }, { roleId: { in: user.roleIds } }],
        AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }],
      },
      select: { caseId: true, permission: { select: { key: true } } },
    }),
    prisma.documentPermission.findMany({
      where: { documentId: { in: docIds }, revokedAt: null, userId: user.id, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      select: { documentId: true, permission: { select: { key: true } } },
    }),
  ]);

  const assigned = new Set(assignments.map((a) => a.caseId));
  const caseGrantKeys = new Map<string, Set<PermissionKey>>();
  for (const g of caseGrants) {
    if (!caseGrantKeys.has(g.caseId)) caseGrantKeys.set(g.caseId, new Set());
    caseGrantKeys.get(g.caseId)!.add(g.permission.key as PermissionKey);
  }
  const docGrantKeys = new Map<string, Set<PermissionKey>>();
  for (const g of docGrants) {
    if (!docGrantKeys.has(g.documentId)) docGrantKeys.set(g.documentId, new Set());
    docGrantKeys.get(g.documentId)!.add(g.permission.key as PermissionKey);
  }
  const oversight = user.roles.some((r) => OVERSIGHT_ROLES.has(r));

  for (const d of docs) {
    // Same rule as hasCaseAccess(): org match, then oversight / IO /
    // assignment / any active case grant.
    const caseAccess =
      d.case.organizationId === user.organizationId &&
      (oversight || d.case.investigatingOfficerId === user.id || assigned.has(d.case.id) || (caseGrantKeys.get(d.case.id)?.size ?? 0) > 0);
    const allowed = new Set<PermissionKey>();
    for (const permission of permissions) {
      const decision = decidePermission({
        roles: user.roles,
        permission,
        caseAccess,
        caseConfidentiality: d.case.confidentiality,
        documentConfidentiality: d.confidentiality,
        caseGrantKeys: caseGrantKeys.get(d.case.id) ?? new Set(),
        documentGrantKeys: docGrantKeys.get(d.id) ?? new Set(),
      });
      if (decision.allowed) allowed.add(permission);
    }
    result.set(d.id, allowed);
  }
  return result;
}
