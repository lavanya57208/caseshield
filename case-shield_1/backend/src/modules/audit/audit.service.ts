import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { maskPiiInText } from "@/modules/privacy/pii/deterministic-pii.provider";
import { AuthenticatedUser } from "@/middleware/auth";
import { can } from "@/lib/authorization";
import { PERMISSIONS } from "@/lib/permissions";
import { ApiError } from "@/lib/errors";

export type AuditMetadataValue = string | number | boolean | null | AuditMetadataValue[] | { [key: string]: AuditMetadataValue };

export interface RecordAuditEventInput {
  actorId?: string | null;
  actorRole?: string | null;
  action: string;
  resource: string;
  caseId?: string | null;
  documentId?: string | null;
  evidenceId?: string | null;
  /** Derived server-side from the case (else the actor) when omitted. */
  organizationId?: string | null;
  result?: "SUCCESS" | "DENIED" | "ERROR";
  reason?: string | null;
  ipMetadata?: string | null;
  /** Safe structured context: IDs, purpose, counts, hashes. Never raw PII. */
  metadata?: Record<string, AuditMetadataValue | undefined>;
  requestId: string;
}

// Defence in depth: callers are responsible for never passing raw PII, but
// every free-text string is also run through the PII masker before it is
// written, so an accidental leak (e.g. an email in a rejection note) is
// stored masked. See docs/security-architecture.md §Audit.
const IDENTIFIER = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{64})$/i;

function sanitizeValue(value: AuditMetadataValue | undefined): AuditMetadataValue | undefined {
  if (value === undefined || value === null) return value;
  // UUIDs and SHA-256 digests are system identifiers, not PII.
  if (typeof value === "string") return IDENTIFIER.test(value) ? value : maskPiiInText(value);
  if (Array.isArray(value)) return value.map((v) => sanitizeValue(v) ?? null);
  if (typeof value === "object") {
    const out: Record<string, AuditMetadataValue> = {};
    for (const [k, v] of Object.entries(value)) {
      const s = sanitizeValue(v);
      if (s !== undefined) out[k] = s;
    }
    return out;
  }
  return value;
}

export function sanitizeAuditMetadata(metadata?: Record<string, AuditMetadataValue | undefined>) {
  if (!metadata) return undefined;
  return sanitizeValue(metadata as AuditMetadataValue) as Prisma.InputJsonObject;
}

// The audit trail is append-oriented: this module exposes create() and
// read paths only — no update/delete method exists anywhere in the
// codebase for audit_events. See docs/security-architecture.md §9.
async function resolveOrganizationId(client: Prisma.TransactionClient | typeof prisma, input: RecordAuditEventInput) {
  if (input.organizationId) return input.organizationId;
  if (input.caseId) {
    const c = await client.case.findUnique({ where: { id: input.caseId }, select: { organizationId: true } });
    if (c) return c.organizationId;
  }
  if (input.actorId) {
    const u = await client.user.findUnique({ where: { id: input.actorId }, select: { organizationId: true } });
    if (u) return u.organizationId;
  }
  return null;
}

// Roles that review audit data across their whole organization. Everyone
// else (Senior Investigator, Judge, or anyone holding a case-level
// audit.view grant) only sees events of cases they may audit.
const ORG_WIDE_AUDIT_ROLES = new Set(["ADMIN", "AUDITOR"]);
const CASE_OVERSIGHT_ROLES = new Set(["ADMIN", "AUDITOR", "JUDGE"]);

export interface AuditScope {
  organizationId: string;
  orgWide: boolean;
  /** Cases the user may audit (always populated, also when orgWide). */
  cases: { id: string; caseNumber: string; title: string; organizationId: string; investigatingOfficerId: string | null; confidentiality: string }[];
}

export interface AuditListFilters {
  caseId?: string;
  evidenceId?: string;
  documentId?: string;
  actorId?: string;
  action?: string;
  result?: "SUCCESS" | "DENIED" | "ERROR";
  organizationId?: string;
  from?: Date;
  to?: Date;
}

export const AuditService = {
  async record(input: RecordAuditEventInput, tx?: Prisma.TransactionClient) {
    const client = tx ?? prisma;
    const organizationId = await resolveOrganizationId(client, input);
    return client.auditEvent.create({
      data: {
        actorId: input.actorId ?? null,
        actorRole: input.actorRole ?? null,
        action: input.action,
        resource: input.resource,
        caseId: input.caseId ?? null,
        documentId: input.documentId ?? null,
        evidenceId: input.evidenceId ?? null,
        organizationId,
        result: input.result ?? "SUCCESS",
        reason: input.reason ? maskPiiInText(input.reason) : null,
        ipMetadata: input.ipMetadata ?? null,
        metadata: sanitizeAuditMetadata(input.metadata),
        requestId: input.requestId,
      },
    });
  },

  /**
   * Resolves which audit data `user` may query. Authorization is evaluated
   * per case through lib/authorization.ts#can(audit.view), so a case-level
   * audit.view grant works and a role baseline alone never reaches a case
   * the user has no access to.
   */
  async scopeFor(user: AuthenticatedUser): Promise<AuditScope> {
    const oversight = user.roles.some((r) => CASE_OVERSIGHT_ROLES.has(r));
    const candidates = await prisma.case.findMany({
      where: {
        organizationId: user.organizationId,
        deletedAt: null,
        ...(oversight
          ? {}
          : {
              OR: [
                { investigatingOfficerId: user.id },
                { assignments: { some: { userId: user.id } } },
                { permissions: { some: { OR: [{ userId: user.id }, { roleId: { in: user.roleIds } }], revokedAt: null } } },
              ],
            }),
      },
      select: { id: true, caseNumber: true, title: true, organizationId: true, investigatingOfficerId: true, confidentiality: true },
      orderBy: { caseNumber: "desc" },
    });
    const cases: AuditScope["cases"] = [];
    for (const c of candidates) {
      if ((await can(user, PERMISSIONS.AUDIT_VIEW, { case: c })).allowed) cases.push(c);
    }
    const orgWide = user.roles.some((r) => ORG_WIDE_AUDIT_ROLES.has(r)) && cases.length === candidates.length;
    return { organizationId: user.organizationId, orgWide, cases };
  },

  async list(user: AuthenticatedUser, filters: AuditListFilters, page: number, pageSize: number, requestId: string) {
    const scope = await AuditService.scopeFor(user);
    const deny = async (reason: string) => {
      await AuditService.record({
        actorId: user.id,
        actorRole: user.roles[0],
        action: "AUDIT_QUERY_DENIED",
        resource: "audit",
        caseId: filters.caseId && scope.cases.some((c) => c.id === filters.caseId) ? filters.caseId : null,
        result: "DENIED",
        reason,
        metadata: { caseId: filters.caseId, evidenceId: filters.evidenceId, documentId: filters.documentId },
        requestId,
      });
      return ApiError.forbidden("AUDIT_ACCESS_DENIED", reason);
    };

    if (!scope.orgWide && scope.cases.length === 0) throw await deny("You are not authorized to view audit data.");
    if (filters.organizationId && filters.organizationId !== user.organizationId) {
      throw await deny("Audit data of another organization is not available.");
    }

    const caseIds = new Set(scope.cases.map((c) => c.id));
    const evidenceInScope = async (caseId: string, evidence: { confidentiality: string }) => {
      const c = scope.cases.find((x) => x.id === caseId);
      return !!c && (await can(user, PERMISSIONS.AUDIT_VIEW, { case: c, evidence })).allowed;
    };

    if (filters.caseId && !caseIds.has(filters.caseId)) throw await deny("You are not authorized to view audit data for this case.");
    if (filters.evidenceId) {
      const e = await prisma.evidence.findUnique({ where: { id: filters.evidenceId }, select: { caseId: true, confidentiality: true } });
      if (!e || !(await evidenceInScope(e.caseId, e))) throw await deny("You are not authorized to view audit data for this evidence.");
    }
    if (filters.documentId) {
      const d = await prisma.document.findUnique({ where: { id: filters.documentId }, select: { caseId: true } });
      if (!d || !caseIds.has(d.caseId)) throw await deny("You are not authorized to view audit data for this document.");
    }

    const where: Prisma.AuditEventWhereInput = {
      organizationId: user.organizationId,
      ...(scope.orgWide ? {} : { caseId: { in: [...caseIds] } }),
      AND: [
        filters.caseId ? { caseId: filters.caseId } : {},
        filters.evidenceId ? { evidenceId: filters.evidenceId } : {},
        filters.documentId ? { documentId: filters.documentId } : {},
        filters.actorId ? { actorId: filters.actorId } : {},
        filters.action ? { action: filters.action } : {},
        filters.result ? { result: filters.result } : {},
        filters.from || filters.to ? { occurredAt: { gte: filters.from, lte: filters.to } } : {},
      ],
    };

    const [items, total] = await Promise.all([
      prisma.auditEvent.findMany({
        where,
        orderBy: { occurredAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          actor: { select: { fullName: true } },
          case: { select: { caseNumber: true } },
          evidence: { select: { evidenceNumber: true } },
          document: { select: { documentNumber: true } },
        },
      }),
      prisma.auditEvent.count({ where }),
    ]);
    return { items, total, page, pageSize, scope: { orgWide: scope.orgWide, caseCount: scope.cases.length } };
  },

  /** Filter options, restricted to the same scope as list(). */
  async facets(user: AuthenticatedUser, caseId?: string) {
    const scope = await AuditService.scopeFor(user);
    if (!scope.orgWide && scope.cases.length === 0) throw ApiError.forbidden("AUDIT_ACCESS_DENIED", "You are not authorized to view audit data.");
    const caseIds = scope.cases.map((c) => c.id);
    if (caseId && !caseIds.includes(caseId)) throw ApiError.forbidden("AUDIT_ACCESS_DENIED", "You are not authorized to view audit data for this case.");
    const eventWhere: Prisma.AuditEventWhereInput = {
      organizationId: user.organizationId,
      ...(caseId ? { caseId } : scope.orgWide ? {} : { caseId: { in: caseIds } }),
    };
    const [actions, actorRows, evidence, organization] = await Promise.all([
      prisma.auditEvent.findMany({ where: eventWhere, distinct: ["action"], select: { action: true }, orderBy: { action: "asc" } }),
      prisma.auditEvent.findMany({ where: { ...eventWhere, actorId: { not: null } }, distinct: ["actorId"], select: { actor: { select: { id: true, fullName: true } } } }),
      prisma.evidence.findMany({
        where: { caseId: caseId ? caseId : { in: caseIds }, deletedAt: null },
        select: { id: true, evidenceNumber: true, title: true, caseId: true },
        orderBy: { evidenceNumber: "asc" },
      }),
      prisma.organization.findUnique({ where: { id: user.organizationId }, select: { id: true, name: true } }),
    ]);
    return {
      orgWide: scope.orgWide,
      organization,
      cases: scope.cases.map((c) => ({ id: c.id, caseNumber: c.caseNumber, title: c.title })),
      evidence,
      actors: actorRows
        .map((r) => r.actor)
        .filter((a): a is { id: string; fullName: string } => !!a)
        .sort((a, b) => a.fullName.localeCompare(b.fullName)),
      actions: actions.map((a) => a.action),
      results: ["SUCCESS", "DENIED", "ERROR"],
    };
  },

  async forCase(caseId: string, limit = 50) {
    return prisma.auditEvent.findMany({
      where: { caseId },
      orderBy: { occurredAt: "desc" },
      take: limit,
      include: { actor: { select: { fullName: true, email: true } } },
    });
  },
};
