import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/errors";
import { sha256 } from "@/lib/hash";
import { generateEvidenceNumber } from "@/lib/ids";
import { can, hasCaseAccess, CaseAccessRecord } from "@/lib/authorization";
import { PERMISSIONS } from "@/lib/permissions";
import { AuthenticatedUser } from "@/middleware/auth";
import { AuditService, RecordAuditEventInput } from "@/modules/audit/audit.service";
import { NotificationsService } from "@/modules/notifications/notifications.service";
import { SecurityService } from "@/modules/security/security.service";
import { getStorageProvider } from "@/modules/storage";
import { computeCustodyEventHash, verifyCustodyChain } from "@/modules/evidence/custody-chain";
import { DirectAction, EvidenceStatus, InvalidTransitionError, LifecycleAction, nextStatus } from "@/modules/evidence/evidence-lifecycle";
import {
  allowedEvidenceActions,
  canViewEvidence,
  EvidencePermission,
  EvidenceUiAction,
  isCourtOnlyViewer,
  PendingTransferForPolicy,
  validateTransferTarget,
} from "@/modules/evidence/evidence-policy";
import {
  CandidatesQuerySchema,
  EvidenceActionSchema,
  InitiateTransferSchema,
  ListEvidenceQuerySchema,
  RegisterEvidenceSchema,
  RejectTransferSchema,
  RespondTransferSchema,
} from "@/modules/evidence/evidence.schemas";

type Tx = Prisma.TransactionClient;

const EVIDENCE_PERMISSIONS: EvidencePermission[] = [
  "evidence.view",
  "evidence.transfer",
  "evidence.receive",
  "evidence.examine",
  "evidence.seal",
  "evidence.submit",
  "evidence.archive",
  "evidence.verify",
  "audit.view",
];

/** A repeat view by the same user within this window is not re-appended to the custody chain (it is still audited). */
const VIEW_DEDUP_WINDOW_MS = 30 * 60 * 1000;

const DIRECT_ACTION_UI: Record<DirectAction, EvidenceUiAction> = {
  EXAMINED: "EXAMINE",
  SEALED: "SEAL",
  UNSEALED: "UNSEAL",
  SUBMITTED: "SUBMIT",
  RETURNED: "RETURN",
  ARCHIVED: "ARCHIVE",
};

const DIRECT_ACTION_AUDIT: Record<DirectAction, string> = {
  EXAMINED: "EVIDENCE_EXAMINED",
  SEALED: "EVIDENCE_SEALED",
  UNSEALED: "EVIDENCE_UNSEALED",
  SUBMITTED: "EVIDENCE_SUBMITTED",
  RETURNED: "EVIDENCE_RETURNED",
  ARCHIVED: "EVIDENCE_ARCHIVED",
};

const userSummary = { select: { id: true, fullName: true, department: true } } as const;

const evidenceInclude = {
  case: true,
  collectedBy: userSummary,
  registeredBy: userSummary,
  currentCustodian: userSummary,
  originalDocument: { select: { id: true, documentNumber: true, title: true, type: true, confidentiality: true, caseId: true } },
  originalVersion: { select: { id: true, versionNumber: true, fileName: true, mimeType: true, fileSize: true, sha256Hash: true, storageKey: true } },
  transfers: {
    where: { status: "PENDING" as const },
    include: { fromCustodian: userSummary, toCustodian: userSummary, initiatedBy: userSummary },
  },
} satisfies Prisma.EvidenceInclude;

type EvidenceWithRelations = Prisma.EvidenceGetPayload<{ include: typeof evidenceInclude }>;

// ---------------------------------------------------------------------------
// Authorization context
// ---------------------------------------------------------------------------

/**
 * Effective evidence permissions of `user` on one case, per confidentiality
 * level (lib/authorization.ts#can decides; results memoized per request).
 */
async function accessContext(user: AuthenticatedUser, caseRecord: CaseAccessRecord) {
  const cache = new Map<string, Promise<Set<EvidencePermission>>>();
  const permsFor = (confidentiality: string) => {
    const key = confidentiality === "RESTRICTED" || confidentiality === "HIGHLY_CONFIDENTIAL" ? "HIGH" : "NORMAL";
    if (!cache.has(key)) {
      cache.set(
        key,
        (async () => {
          const set = new Set<EvidencePermission>();
          for (const p of EVIDENCE_PERMISSIONS) {
            if ((await can(user, p as any, { case: caseRecord, evidence: { confidentiality } })).allowed) set.add(p);
          }
          return set;
        })(),
      );
    }
    return cache.get(key)!;
  };
  const explicitViewGrant = await prisma.casePermission.count({
    where: {
      caseId: caseRecord.id,
      revokedAt: null,
      permission: { key: PERMISSIONS.EVIDENCE_VIEW },
      OR: [{ userId: user.id }, { roleId: { in: user.roleIds } }],
      AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }],
    },
  });
  return { permsFor, courtOnly: isCourtOnlyViewer(user.roles, explicitViewGrant > 0) };
}

function pendingOf(e: { transfers: { toCustodianId: string; initiatedById: string; previousStatus: EvidenceStatus }[] }): PendingTransferForPolicy | null {
  return e.transfers[0] ?? null;
}

async function toAuthUser(userId: string): Promise<(AuthenticatedUser & { status: string; deletedAt: Date | null }) | null> {
  const u = await prisma.user.findUnique({ where: { id: userId }, include: { userRoles: { include: { role: true } } } });
  if (!u) return null;
  return {
    id: u.id,
    email: u.email,
    fullName: u.fullName,
    organizationId: u.organizationId,
    roles: u.userRoles.map((ur) => ur.role.key),
    roleIds: u.userRoles.map((ur) => ur.role.id),
    status: u.status,
    deletedAt: u.deletedAt,
  };
}

/** Whether `candidate` could hold evidence of this confidentiality on this case. */
async function recipientEligibility(candidate: AuthenticatedUser, caseRecord: CaseAccessRecord, confidentiality: string, submitted: boolean) {
  const caseAccess = await hasCaseAccess(candidate, caseRecord);
  if (!caseAccess) return { caseAccess, canReceive: false };
  const ev = { confidentiality };
  const receive = (await can(candidate, PERMISSIONS.EVIDENCE_RECEIVE, { case: caseRecord, evidence: ev })).allowed;
  const view = (await can(candidate, PERMISSIONS.EVIDENCE_VIEW, { case: caseRecord, evidence: ev })).allowed;
  const courtOnly = isCourtOnlyViewer(candidate.roles, false);
  return { caseAccess, canReceive: receive && view && (!courtOnly || submitted) };
}

function actorOf(user: AuthenticatedUser) {
  return { actorId: user.id, actorRole: user.roles[0] ?? null, organizationId: user.organizationId };
}

async function audit(input: RecordAuditEventInput, tx?: Tx) {
  await AuditService.record(input, tx);
}

// ---------------------------------------------------------------------------
// Custody chain append (always under a row lock on the evidence item)
// ---------------------------------------------------------------------------

async function lockEvidence(tx: Tx, evidenceId: string) {
  // Serializes every custody mutation of one item: two concurrent requests
  // can never both append sequence N+1 or both open a transfer.
  await tx.$queryRaw`SELECT "id" FROM "evidence" WHERE "id" = ${evidenceId} FOR UPDATE`;
  const e = await tx.evidence.findUnique({ where: { id: evidenceId }, include: evidenceInclude });
  if (!e || e.deletedAt) throw ApiError.notFound("Evidence");
  return e;
}

interface AppendInput {
  action: LifecycleAction | "REGISTERED";
  fromUserId: string | null;
  toUserId: string | null;
  actorId: string;
  reason: string;
  notes?: string | null;
  location?: string | null;
  transferId?: string | null;
  hashAtEvent?: string | null;
}

async function appendCustodyEvent(
  tx: Tx,
  evidence: { id: string; caseId: string },
  organizationId: string,
  input: AppendInput,
  evidenceUpdate: Prisma.EvidenceUpdateInput = {},
  touchActivity = true,
) {
  const last = await tx.custodyEvent.findFirst({ where: { evidenceId: evidence.id }, orderBy: { sequence: "desc" } });
  const occurredAt = new Date(); // server-side timestamp only
  const data = {
    evidenceId: evidence.id,
    sequence: (last?.sequence ?? 0) + 1,
    action: input.action,
    fromUserId: input.fromUserId,
    toUserId: input.toUserId,
    actorId: input.actorId,
    organizationId,
    transferId: input.transferId ?? null,
    reason: input.reason,
    notes: input.notes ?? null,
    location: input.location ?? null,
    hashAtEvent: input.hashAtEvent ?? null,
    occurredAt,
    previousEventHash: last?.eventHash ?? null,
  };
  const eventHash = computeCustodyEventHash(data);
  const event = await tx.custodyEvent.create({ data: { ...data, eventHash } });
  await tx.evidence.update({
    where: { id: evidence.id },
    data: {
      ...evidenceUpdate,
      custodyHeadHash: eventHash,
      custodyEventCount: data.sequence,
      ...(touchActivity ? { lastActivityAt: occurredAt } : {}),
    },
  });
  if (touchActivity) await tx.case.update({ where: { id: evidence.caseId }, data: { lastActivityAt: occurredAt } });
  return event;
}

function mapConcurrencyError(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    throw ApiError.conflict("CONCURRENT_CUSTODY_UPDATE", "The evidence was updated by someone else. Reload and try again.");
  }
  throw err;
}

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

async function toDto(user: AuthenticatedUser, e: EvidenceWithRelations, perms: Set<EvidencePermission>, courtOnly: boolean) {
  const pending = e.transfers[0] ?? null;
  let originalDocument = null;
  if (e.originalDocument && e.originalVersion) {
    const canViewDoc = (await can(user, PERMISSIONS.DOCUMENT_VIEW, { case: e.case, document: e.originalDocument })).allowed;
    originalDocument = {
      id: e.originalDocument.id,
      documentNumber: e.originalDocument.documentNumber,
      title: canViewDoc ? e.originalDocument.title : null,
      type: e.originalDocument.type,
      versionNumber: e.originalVersion.versionNumber,
      fileName: canViewDoc ? e.originalVersion.fileName : null,
      mimeType: e.originalVersion.mimeType,
      fileSize: e.originalVersion.fileSize,
      registeredVersionHash: e.originalVersion.sha256Hash,
      canView: canViewDoc,
    };
  }
  return {
    id: e.id,
    evidenceNumber: e.evidenceNumber,
    caseId: e.caseId,
    case: { id: e.case.id, caseNumber: e.case.caseNumber, title: e.case.title },
    title: e.title,
    type: e.type,
    description: e.description,
    source: e.source,
    collectedAt: e.collectedAt,
    location: e.location,
    status: e.status,
    confidentiality: e.confidentiality,
    notes: e.notes,
    collectedBy: e.collectedBy,
    registeredBy: e.registeredBy,
    currentCustodian: e.currentCustodian,
    originalHash: e.originalHash,
    currentHash: e.currentHash,
    integrityStatus: e.integrityStatus,
    lastVerifiedAt: e.lastVerifiedAt,
    submittedAt: e.submittedAt,
    custodyEventCount: e.custodyEventCount,
    custodyHeadHash: e.custodyHeadHash,
    lastActivityAt: e.lastActivityAt,
    createdAt: e.createdAt,
    originalDocument,
    pendingTransfer: pending
      ? {
          id: pending.id,
          fromCustodian: pending.fromCustodian,
          toCustodian: pending.toCustodian,
          initiatedBy: pending.initiatedBy,
          reason: pending.reason,
          notes: pending.notes,
          initiatedAt: pending.initiatedAt,
        }
      : null,
    allowedActions: allowedEvidenceActions(e, user.id, perms, courtOnly, pendingOf(e)),
  };
}

// ---------------------------------------------------------------------------
// Loading + view authorization
// ---------------------------------------------------------------------------

async function loadCaseOrThrow(caseId: string) {
  const c = await prisma.case.findFirst({ where: { id: caseId, deletedAt: null } });
  if (!c) throw ApiError.notFound("Case");
  return c;
}

async function loadEvidenceOrThrow(evidenceId: string) {
  const e = await prisma.evidence.findFirst({ where: { id: evidenceId, deletedAt: null }, include: evidenceInclude });
  if (!e) throw ApiError.notFound("Evidence");
  return e;
}

/** Loads an item and asserts the user may view it; denials are audited. */
async function authorizeView(user: AuthenticatedUser, evidenceId: string, requestId: string, auditAction = "EVIDENCE_VIEWED") {
  const e = await loadEvidenceOrThrow(evidenceId);
  if (e.case.organizationId !== user.organizationId) throw ApiError.notFound("Evidence"); // never confirm cross-tenant existence
  const ctx = await accessContext(user, e.case);
  const perms = await ctx.permsFor(e.confidentiality);
  if (!canViewEvidence(e, perms, ctx.courtOnly)) {
    await audit({
      ...actorOf(user),
      action: auditAction,
      resource: `evidence:${e.id}`,
      caseId: e.caseId,
      evidenceId: e.id,
      result: "DENIED",
      reason: ctx.courtOnly && perms.has("evidence.view") ? "Evidence has not been submitted to court." : "No access to this evidence.",
      requestId,
    });
    throw ApiError.forbidden("EVIDENCE_ACCESS_DENIED", "You do not have access to this evidence.");
  }
  return { e, perms, ctx };
}

async function deny(user: AuthenticatedUser, e: { id: string; caseId: string }, action: string, reason: string, requestId: string, error: ApiError) {
  await audit({ ...actorOf(user), action, resource: `evidence:${e.id}`, caseId: e.caseId, evidenceId: e.id, result: "DENIED", reason, requestId });
  return error;
}

function transitionError(err: unknown) {
  if (err instanceof InvalidTransitionError) return ApiError.conflict("INVALID_TRANSITION", err.message);
  return err;
}

async function notifyMany(userIds: (string | null | undefined)[], exclude: string, payload: Omit<Parameters<typeof NotificationsService.send>[0], "userId">) {
  const unique = [...new Set(userIds.filter((u): u is string => !!u && u !== exclude))];
  await Promise.all(unique.map((userId) => NotificationsService.send({ ...payload, userId })));
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export const EvidenceService = {
  async register(user: AuthenticatedUser, input: z.infer<typeof RegisterEvidenceSchema>, requestId: string) {
    const caseRecord = await loadCaseOrThrow(input.caseId);
    const authz = await can(user, PERMISSIONS.EVIDENCE_REGISTER, { case: caseRecord, evidence: { confidentiality: input.confidentiality } });
    if (!authz.allowed) {
      await audit({ ...actorOf(user), action: "EVIDENCE_REGISTERED", resource: "evidence", caseId: caseRecord.id, result: "DENIED", reason: authz.reason, requestId });
      throw ApiError.forbidden("EVIDENCE_ACCESS_DENIED", authz.reason);
    }

    // Collector: any active member of the case (defaults to the registrar).
    let collectedById = user.id;
    if (input.collectedById && input.collectedById !== user.id) {
      const collector = await toAuthUser(input.collectedById);
      if (!collector || collector.organizationId !== user.organizationId || collector.status !== "ACTIVE" || collector.deletedAt || !(await hasCaseAccess(collector, caseRecord))) {
        throw ApiError.badRequest("INVALID_COLLECTOR", "The collecting officer must be an active member of this case.");
      }
      collectedById = collector.id;
    }

    // Initial custodian: must be eligible to hold this evidence.
    let custodianId = user.id;
    if (input.initialCustodianId && input.initialCustodianId !== user.id) {
      const candidate = await toAuthUser(input.initialCustodianId);
      const eligibility = candidate ? await recipientEligibility(candidate, caseRecord, input.confidentiality, false) : { caseAccess: false, canReceive: false };
      const check = validateTransferTarget({
        reason: "initial custody",
        currentCustodianId: null,
        organizationId: caseRecord.organizationId,
        recipient: candidate,
        recipientHasCaseAccess: eligibility.caseAccess,
        recipientCanReceive: eligibility.canReceive,
      });
      if (!check.ok) throw ApiError.badRequest(`INVALID_CUSTODIAN_${check.code}`, check.message.replace("recipient", "initial custodian"));
      custodianId = candidate!.id;
    }

    // Digital evidence: pin an immutable document version and hash the
    // stored bytes now. Nothing is copied — the evidence references it.
    let documentLink: { documentId: string; versionId: string; hash: string } | null = null;
    if (input.documentId) {
      const doc = await prisma.document.findFirst({
        where: { id: input.documentId, deletedAt: null },
        include: { versions: { orderBy: { versionNumber: "desc" } } },
      });
      if (!doc || doc.caseId !== caseRecord.id) throw ApiError.badRequest("INVALID_DOCUMENT", "The document must belong to this case.");
      if (!(await can(user, PERMISSIONS.DOCUMENT_VIEW, { case: caseRecord, document: doc })).allowed) {
        throw ApiError.forbidden("DOCUMENT_ACCESS_DENIED", "You do not have access to the selected document.");
      }
      const version = input.versionNumber ? doc.versions.find((v) => v.versionNumber === input.versionNumber) : doc.versions[0];
      if (!version) throw ApiError.badRequest("INVALID_DOCUMENT_VERSION", "The selected document version does not exist.");
      let bytes: Buffer;
      try {
        bytes = await getStorageProvider().get(version.storageKey);
      } catch {
        throw ApiError.conflict("DOCUMENT_UNAVAILABLE", "The stored document could not be read, so it cannot be registered as evidence.");
      }
      const hash = sha256(bytes);
      if (hash !== version.sha256Hash) {
        await SecurityService.record({
          type: "INTEGRITY_VIOLATION",
          userId: user.id,
          caseId: caseRecord.id,
          documentId: doc.id,
          severity: "HIGH",
          detail: `Evidence registration refused: ${doc.documentNumber} v${version.versionNumber} does not match its registered hash.`,
        });
        throw ApiError.conflict("INTEGRITY_VIOLATION", "The document no longer matches its registered hash and cannot be registered as evidence.");
      }
      documentLink = { documentId: doc.id, versionId: version.id, hash };
    }

    let created: { id: string } | null = null;
    for (let attempt = 0; attempt < 3 && !created; attempt++) {
      const evidenceNumber = await generateEvidenceNumber();
      try {
        created = await prisma.$transaction(async (tx) => {
          const e = await tx.evidence.create({
            data: {
              evidenceNumber,
              caseId: caseRecord.id,
              title: input.title,
              type: input.type,
              description: input.description,
              source: input.source,
              collectedById,
              collectedAt: input.collectedAt,
              location: input.location,
              registeredById: user.id,
              currentCustodianId: custodianId,
              status: "REGISTERED",
              confidentiality: input.confidentiality,
              notes: input.notes,
              originalDocumentId: documentLink?.documentId,
              originalVersionId: documentLink?.versionId,
              originalHash: documentLink?.hash,
              currentHash: documentLink?.hash,
              integrityStatus: documentLink ? "VERIFIED" : null,
              lastVerifiedAt: documentLink ? new Date() : null,
            },
          });
          await appendCustodyEvent(tx, e, caseRecord.organizationId, {
            action: "REGISTERED",
            fromUserId: null,
            toUserId: custodianId,
            actorId: user.id,
            reason: "Evidence registered in Case Shield.",
            notes: input.notes,
            location: input.location,
            hashAtEvent: documentLink?.hash,
          });
          await audit(
            {
              ...actorOf(user),
              action: "EVIDENCE_REGISTERED",
              resource: `evidence:${e.id}`,
              caseId: caseRecord.id,
              evidenceId: e.id,
              documentId: documentLink?.documentId,
              result: "SUCCESS",
              metadata: {
                evidenceNumber,
                type: input.type,
                initialCustodianId: custodianId,
                collectedById,
                originalHash: documentLink?.hash ?? null,
              },
              requestId,
            },
            tx,
          );
          return e;
        });
      } catch (err) {
        const retryable = err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002" && attempt < 2;
        if (!retryable) mapConcurrencyError(err);
      }
    }

    if (custodianId !== user.id) {
      await NotificationsService.send({
        userId: custodianId,
        type: "EVIDENCE_TRANSFERRED",
        title: "Evidence assigned to your custody",
        body: `${user.fullName} registered evidence on ${caseRecord.caseNumber} with you as initial custodian.`,
        relatedCaseId: caseRecord.id,
        relatedEvidenceId: created!.id,
      });
    }

    const { e, perms, ctx } = await authorizeView(user, created!.id, requestId);
    return toDto(user, e, perms, ctx.courtOnly);
  },

  async list(user: AuthenticatedUser, query: z.infer<typeof ListEvidenceQuerySchema>) {
    const caseRecord = await loadCaseOrThrow(query.caseId);
    const authz = await can(user, PERMISSIONS.EVIDENCE_VIEW, { case: caseRecord });
    if (!authz.allowed) throw ApiError.forbidden("EVIDENCE_ACCESS_DENIED", authz.reason);
    const ctx = await accessContext(user, caseRecord);
    const highAllowed = (await ctx.permsFor("RESTRICTED")).has("evidence.view");

    const where: Prisma.EvidenceWhereInput = {
      caseId: caseRecord.id,
      deletedAt: null,
      status: query.status,
      type: query.type,
      ...(ctx.courtOnly ? { submittedAt: { not: null } } : {}),
      ...(highAllowed ? {} : { confidentiality: { notIn: ["RESTRICTED", "HIGHLY_CONFIDENTIAL"] } }),
      ...(query.q
        ? {
            OR: [
              { title: { contains: query.q, mode: "insensitive" } },
              { evidenceNumber: { contains: query.q, mode: "insensitive" } },
              { description: { contains: query.q, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.evidence.findMany({
        where,
        orderBy: { evidenceNumber: "asc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: evidenceInclude,
      }),
      prisma.evidence.count({ where }),
    ]);
    const items = [];
    for (const e of rows) {
      const perms = await ctx.permsFor(e.confidentiality);
      if (canViewEvidence(e, perms, ctx.courtOnly)) items.push(await toDto(user, e, perms, ctx.courtOnly));
    }
    return { items, total, page: query.page, pageSize: query.pageSize, courtOnly: ctx.courtOnly };
  },

  /** Evidence detail. Every successful view is audited and (de-duplicated) appended as VIEWED. */
  async getById(user: AuthenticatedUser, evidenceId: string, requestId: string) {
    const { e, perms, ctx } = await authorizeView(user, evidenceId, requestId);
    await audit({ ...actorOf(user), action: "EVIDENCE_VIEWED", resource: `evidence:${e.id}`, caseId: e.caseId, evidenceId: e.id, result: "SUCCESS", requestId });

    const recentView = await prisma.custodyEvent.findFirst({
      where: { evidenceId: e.id, actorId: user.id, action: "VIEWED", occurredAt: { gt: new Date(Date.now() - VIEW_DEDUP_WINDOW_MS) } },
      select: { id: true },
    });
    let current = e;
    if (!recentView) {
      current = await prisma
        .$transaction(async (tx) => {
          const locked = await lockEvidence(tx, e.id);
          await appendCustodyEvent(
            tx,
            locked,
            e.case.organizationId,
            { action: "VIEWED", fromUserId: null, toUserId: null, actorId: user.id, reason: "Evidence record accessed." },
            {},
            false,
          );
          return tx.evidence.findUniqueOrThrow({ where: { id: e.id }, include: evidenceInclude });
        })
        .catch(mapConcurrencyError);
    }
    return toDto(user, current, perms, ctx.courtOnly);
  },

  async custodyTimeline(user: AuthenticatedUser, evidenceId: string, requestId: string) {
    const { e } = await authorizeView(user, evidenceId, requestId);
    const events = await prisma.custodyEvent.findMany({
      where: { evidenceId: e.id },
      orderBy: { sequence: "asc" },
      include: {
        fromUser: userSummary,
        toUser: userSummary,
        actor: userSummary,
        transfer: { select: { id: true, status: true } },
      },
    });
    return {
      evidenceNumber: e.evidenceNumber,
      headHash: e.custodyHeadHash,
      eventCount: e.custodyEventCount,
      events: events.map((ev) => ({
        id: ev.id,
        sequence: ev.sequence,
        action: ev.action,
        reason: ev.reason,
        notes: ev.notes,
        location: ev.location,
        occurredAt: ev.occurredAt,
        fromUser: ev.fromUser,
        toUser: ev.toUser,
        actor: ev.actor,
        transfer: ev.transfer,
        hashAtEvent: ev.hashAtEvent,
        previousEventHash: ev.previousEventHash,
        eventHash: ev.eventHash,
      })),
    };
  },

  /** Users the evidence may be registered to (initial custodian) or collected by. */
  async registrationCandidates(user: AuthenticatedUser, query: z.infer<typeof CandidatesQuerySchema>) {
    const caseRecord = await loadCaseOrThrow(query.caseId);
    const authz = await can(user, PERMISSIONS.EVIDENCE_REGISTER, { case: caseRecord, evidence: { confidentiality: query.confidentiality } });
    if (!authz.allowed) throw ApiError.forbidden("EVIDENCE_ACCESS_DENIED", authz.reason);
    const users = await prisma.user.findMany({
      where: { organizationId: caseRecord.organizationId, status: "ACTIVE", deletedAt: null },
      include: { userRoles: { include: { role: true } } },
      orderBy: { fullName: "asc" },
    });
    const custodians = [];
    const collectors = [];
    for (const u of users) {
      const candidate = (await toAuthUser(u.id))!;
      const eligibility = await recipientEligibility(candidate, caseRecord, query.confidentiality, false);
      const summary = { id: u.id, fullName: u.fullName, department: u.department, roles: u.userRoles.map((ur) => ({ key: ur.role.key, name: ur.role.name })) };
      if (eligibility.caseAccess) collectors.push(summary);
      if (eligibility.canReceive) custodians.push(summary);
    }
    return { custodians, collectors };
  },

  async transferCandidates(user: AuthenticatedUser, evidenceId: string, requestId: string) {
    const { e, perms } = await authorizeView(user, evidenceId, requestId);
    if (!perms.has("evidence.transfer")) throw ApiError.forbidden("EVIDENCE_ACCESS_DENIED", "You may not transfer this evidence.");
    const users = await prisma.user.findMany({
      where: {
        organizationId: e.case.organizationId,
        status: "ACTIVE",
        deletedAt: null,
        id: { not: e.currentCustodianId ?? undefined },
      },
      include: { userRoles: { include: { role: true } } },
      orderBy: { fullName: "asc" },
    });
    const eligible = [];
    for (const u of users) {
      const candidate = (await toAuthUser(u.id))!;
      const { canReceive } = await recipientEligibility(candidate, e.case, e.confidentiality, !!e.submittedAt);
      if (canReceive) {
        eligible.push({ id: u.id, fullName: u.fullName, department: u.department, roles: u.userRoles.map((ur) => ({ key: ur.role.key, name: ur.role.name })) });
      }
    }
    return eligible;
  },

  async initiateTransfer(user: AuthenticatedUser, evidenceId: string, input: z.infer<typeof InitiateTransferSchema>, requestId: string) {
    const { e, perms, ctx } = await authorizeView(user, evidenceId, requestId, "EVIDENCE_TRANSFER_INITIATED");

    const recipient = await toAuthUser(input.toUserId);
    const eligibility = recipient ? await recipientEligibility(recipient, e.case, e.confidentiality, !!e.submittedAt) : { caseAccess: false, canReceive: false };

    const result = await prisma
      .$transaction(async (tx) => {
        const locked = await lockEvidence(tx, e.id);
        const allowed = allowedEvidenceActions(locked, user.id, perms, ctx.courtOnly, pendingOf(locked));
        if (!allowed.includes("TRANSFER")) {
          const reason = pendingOf(locked)
            ? "A transfer of this evidence is already pending."
            : locked.currentCustodianId !== user.id
              ? "Only the current custodian can transfer this evidence."
              : !perms.has("evidence.transfer")
                ? "Your role does not include evidence.transfer."
                : `Evidence cannot be transferred while ${locked.status.replace(/_/g, " ").toLowerCase()}.`;
          const code = pendingOf(locked) ? 409 : locked.currentCustodianId !== user.id || !perms.has("evidence.transfer") ? 403 : 409;
          return { denied: { reason, code } } as const;
        }
        const check = validateTransferTarget({
          reason: input.reason,
          currentCustodianId: locked.currentCustodianId,
          organizationId: locked.case.organizationId,
          recipient,
          recipientHasCaseAccess: eligibility.caseAccess,
          recipientCanReceive: eligibility.canReceive,
        });
        if (!check.ok) return { denied: { reason: check.message, code: 400, validation: check.code } } as const;

        const to = nextStatus(locked.status, "TRANSFERRED");
        const transfer = await tx.evidenceTransfer.create({
          data: {
            evidenceId: locked.id,
            fromCustodianId: locked.currentCustodianId!,
            toCustodianId: recipient!.id,
            initiatedById: user.id,
            reason: input.reason,
            notes: input.notes,
            previousStatus: locked.status,
          },
        });
        await appendCustodyEvent(
          tx,
          locked,
          locked.case.organizationId,
          {
            action: "TRANSFERRED",
            fromUserId: locked.currentCustodianId,
            toUserId: recipient!.id,
            actorId: user.id,
            reason: input.reason,
            notes: input.notes,
            transferId: transfer.id,
            hashAtEvent: locked.currentHash,
          },
          { status: to },
        );
        await audit(
          {
            ...actorOf(user),
            action: "EVIDENCE_TRANSFER_INITIATED",
            resource: `evidence:${locked.id}`,
            caseId: locked.caseId,
            evidenceId: locked.id,
            result: "SUCCESS",
            reason: input.reason,
            metadata: { transferId: transfer.id, fromCustodianId: locked.currentCustodianId, toCustodianId: recipient!.id },
            requestId,
          },
          tx,
        );
        return { transfer } as const;
      })
      .catch(mapConcurrencyError);

    if ("denied" in result && result.denied) {
      const d = result.denied;
      const error =
        d.code === 400
          ? ApiError.badRequest(`TRANSFER_${(d as any).validation}`, d.reason)
          : d.code === 403
            ? ApiError.forbidden("EVIDENCE_TRANSFER_DENIED", d.reason)
            : ApiError.conflict("INVALID_TRANSITION", d.reason);
      throw await deny(user, e, "EVIDENCE_TRANSFER_INITIATED", d.reason, requestId, error);
    }

    await NotificationsService.send({
      userId: input.toUserId,
      type: "EVIDENCE_TRANSFERRED",
      title: "Evidence Transfer Request",
      body: `${e.evidenceNumber} · From: ${user.fullName} · Reason: ${input.reason}`,
      relatedCaseId: e.caseId,
      relatedEvidenceId: e.id,
    });
    return EvidenceService.getDtoById(user, e.id);
  },

  async acceptTransfer(user: AuthenticatedUser, evidenceId: string, transferId: string, input: z.infer<typeof RespondTransferSchema>, requestId: string) {
    return EvidenceService.respondToTransfer(user, evidenceId, transferId, "ACCEPT", input.notes ?? null, requestId);
  },

  async rejectTransfer(user: AuthenticatedUser, evidenceId: string, transferId: string, input: z.infer<typeof RejectTransferSchema>, requestId: string) {
    return EvidenceService.respondToTransfer(user, evidenceId, transferId, "REJECT", input.reason, requestId);
  },

  async cancelTransfer(user: AuthenticatedUser, evidenceId: string, transferId: string, input: z.infer<typeof RejectTransferSchema>, requestId: string) {
    return EvidenceService.respondToTransfer(user, evidenceId, transferId, "CANCEL", input.reason, requestId);
  },

  async respondToTransfer(
    user: AuthenticatedUser,
    evidenceId: string,
    transferId: string,
    decision: "ACCEPT" | "REJECT" | "CANCEL",
    text: string | null,
    requestId: string,
  ) {
    const auditAction = { ACCEPT: "EVIDENCE_TRANSFER_ACCEPTED", REJECT: "EVIDENCE_TRANSFER_REJECTED", CANCEL: "EVIDENCE_TRANSFER_CANCELLED" }[decision];
    const uiAction: EvidenceUiAction = { ACCEPT: "ACCEPT_TRANSFER", REJECT: "REJECT_TRANSFER", CANCEL: "CANCEL_TRANSFER" }[decision] as EvidenceUiAction;
    const custodyAction: LifecycleAction = { ACCEPT: "RECEIVED", REJECT: "TRANSFER_REJECTED", CANCEL: "TRANSFER_CANCELLED" }[decision] as LifecycleAction;
    const { e, perms, ctx } = await authorizeView(user, evidenceId, requestId, auditAction);

    const result = await prisma
      .$transaction(async (tx) => {
        const locked = await lockEvidence(tx, e.id);
        const pending = locked.transfers[0];
        if (!pending || pending.id !== transferId) return { denied: { code: 409, reason: "This transfer is no longer pending." } } as const;
        const allowed = allowedEvidenceActions(locked, user.id, perms, ctx.courtOnly, pending);
        if (!allowed.includes(uiAction)) {
          const reason =
            decision === "CANCEL" ? "Only the user who initiated the transfer can cancel it." : "Only the designated recipient can respond to this transfer.";
          return { denied: { code: 403, reason } } as const;
        }

        let status: EvidenceStatus;
        try {
          status = nextStatus(locked.status, custodyAction, pending.previousStatus);
        } catch (err) {
          throw transitionError(err);
        }
        const accepted = decision === "ACCEPT";
        await tx.evidenceTransfer.update({
          where: { id: pending.id },
          data: { status: accepted ? "ACCEPTED" : decision === "REJECT" ? "REJECTED" : "CANCELLED", respondedAt: new Date(), responseNote: text },
        });
        await appendCustodyEvent(
          tx,
          locked,
          locked.case.organizationId,
          {
            action: custodyAction,
            fromUserId: pending.fromCustodianId,
            toUserId: accepted ? pending.toCustodianId : pending.fromCustodianId,
            actorId: user.id,
            reason: accepted ? "Custody received and acknowledged by recipient." : text!,
            notes: accepted ? text : null,
            transferId: pending.id,
            hashAtEvent: locked.currentHash,
          },
          accepted ? { status, currentCustodian: { connect: { id: pending.toCustodianId } } } : { status },
        );
        await audit(
          {
            ...actorOf(user),
            action: auditAction,
            resource: `evidence:${locked.id}`,
            caseId: locked.caseId,
            evidenceId: locked.id,
            result: "SUCCESS",
            reason: accepted ? undefined : text,
            metadata: { transferId: pending.id, fromCustodianId: pending.fromCustodianId, toCustodianId: pending.toCustodianId },
            requestId,
          },
          tx,
        );
        return { pending, investigatingOfficerId: locked.case.investigatingOfficerId } as const;
      })
      .catch((err) => {
        if (err instanceof ApiError) throw err;
        return mapConcurrencyError(err);
      });

    if ("denied" in result && result.denied) {
      const d = result.denied;
      const error = d.code === 403 ? ApiError.forbidden("EVIDENCE_TRANSFER_DENIED", d.reason) : ApiError.conflict("TRANSFER_NOT_PENDING", d.reason);
      throw await deny(user, e, auditAction, d.reason, requestId, error);
    }

    const { pending, investigatingOfficerId } = result;
    if (decision === "ACCEPT") {
      await notifyMany([pending.fromCustodianId, pending.initiatedById, investigatingOfficerId], user.id, {
        type: "CUSTODY_ACKNOWLEDGED",
        title: "Evidence custody accepted",
        body: `${user.fullName} accepted custody of ${e.evidenceNumber}.`,
        relatedCaseId: e.caseId,
        relatedEvidenceId: e.id,
      });
    } else if (decision === "REJECT") {
      await notifyMany([pending.initiatedById, pending.fromCustodianId], user.id, {
        type: "EVIDENCE_TRANSFER_REJECTED",
        title: "Evidence transfer rejected",
        body: `${user.fullName} did not accept ${e.evidenceNumber}. Custody remains unchanged.`,
        relatedCaseId: e.caseId,
        relatedEvidenceId: e.id,
      });
    } else {
      await notifyMany([pending.toCustodianId], user.id, {
        type: "PENDING_ACTION",
        title: "Evidence transfer cancelled",
        body: `The transfer of ${e.evidenceNumber} to you was cancelled by ${user.fullName}.`,
        relatedCaseId: e.caseId,
        relatedEvidenceId: e.id,
      });
    }
    return EvidenceService.getDtoById(user, e.id);
  },

  /** Examine / seal / unseal / submit / return / archive — validated against the lifecycle. */
  async performAction(user: AuthenticatedUser, evidenceId: string, input: z.infer<typeof EvidenceActionSchema>, requestId: string) {
    const auditAction = DIRECT_ACTION_AUDIT[input.action];
    const { e, perms, ctx } = await authorizeView(user, evidenceId, requestId, auditAction);

    const result = await prisma
      .$transaction(async (tx) => {
        const locked = await lockEvidence(tx, e.id);
        let status: EvidenceStatus;
        try {
          status = nextStatus(locked.status, input.action);
        } catch (err) {
          return { denied: { code: 409, reason: (err as Error).message } } as const;
        }
        if (pendingOf(locked)) return { denied: { code: 409, reason: "A transfer of this evidence is pending." } } as const;
        const allowed = allowedEvidenceActions(locked, user.id, perms, ctx.courtOnly, null);
        if (!allowed.includes(DIRECT_ACTION_UI[input.action])) {
          const reason =
            input.action !== "ARCHIVED" && locked.currentCustodianId !== user.id
              ? "Only the current custodian can record this action."
              : "Your role does not permit this action on this evidence.";
          return { denied: { code: 403, reason } } as const;
        }
        await appendCustodyEvent(
          tx,
          locked,
          locked.case.organizationId,
          {
            action: input.action,
            fromUserId: locked.currentCustodianId,
            toUserId: locked.currentCustodianId,
            actorId: user.id,
            reason: input.reason,
            notes: input.notes,
            hashAtEvent: locked.currentHash,
          },
          { status, ...(input.action === "SUBMITTED" ? { submittedAt: new Date() } : {}) },
        );
        await audit(
          {
            ...actorOf(user),
            action: auditAction,
            resource: `evidence:${locked.id}`,
            caseId: locked.caseId,
            evidenceId: locked.id,
            result: "SUCCESS",
            reason: input.reason,
            metadata: { fromStatus: locked.status, toStatus: status },
            requestId,
          },
          tx,
        );
        return { ok: true, investigatingOfficerId: locked.case.investigatingOfficerId } as const;
      })
      .catch(mapConcurrencyError);

    if ("denied" in result && result.denied) {
      const d = result.denied;
      const error = d.code === 403 ? ApiError.forbidden("EVIDENCE_ACTION_DENIED", d.reason) : ApiError.conflict("INVALID_TRANSITION", d.reason);
      throw await deny(user, e, auditAction, d.reason, requestId, error);
    }
    if (input.action === "SUBMITTED") {
      await notifyMany([result.investigatingOfficerId], user.id, {
        type: "PENDING_ACTION",
        title: "Evidence submitted to court",
        body: `${e.evidenceNumber} was submitted to court by ${user.fullName}.`,
        relatedCaseId: e.caseId,
        relatedEvidenceId: e.id,
      });
    }
    return EvidenceService.getDtoById(user, e.id);
  },

  /** Recalculates SHA-256 of the referenced stored bytes and compares with the registered hash. */
  async verifyIntegrity(user: AuthenticatedUser, evidenceId: string, requestId: string) {
    const { e, perms } = await authorizeView(user, evidenceId, requestId, "EVIDENCE_VERIFIED");
    if (!perms.has("evidence.verify")) {
      throw await deny(user, e, "EVIDENCE_VERIFIED", "Missing evidence.verify", requestId, ApiError.forbidden("EVIDENCE_ACCESS_DENIED", "You may not verify this evidence."));
    }
    if (!e.originalVersion || !e.originalHash) {
      throw ApiError.conflict("NO_DIGITAL_CONTENT", "This evidence item has no attached digital file, so there are no bytes to hash.");
    }

    let currentHash: string | null = null;
    try {
      currentHash = sha256(await getStorageProvider().get(e.originalVersion.storageKey));
    } catch {
      currentHash = null; // missing/unreadable object is itself an integrity failure
    }
    const verified = currentHash === e.originalHash;
    const verifiedAt = new Date();

    await prisma
      .$transaction(async (tx) => {
        const locked = await lockEvidence(tx, e.id);
        await appendCustodyEvent(
          tx,
          locked,
          locked.case.organizationId,
          {
            action: "VERIFIED",
            fromUserId: null,
            toUserId: null,
            actorId: user.id,
            reason: verified ? "Integrity verified: stored bytes match the registered SHA-256." : "Integrity violation: stored bytes do not match the registered SHA-256.",
            hashAtEvent: currentHash,
          },
          { currentHash, integrityStatus: verified ? "VERIFIED" : "VIOLATION", lastVerifiedAt: verifiedAt },
          false,
        );
        await audit(
          {
            ...actorOf(user),
            action: "EVIDENCE_VERIFIED",
            resource: `evidence:${e.id}`,
            caseId: e.caseId,
            evidenceId: e.id,
            documentId: e.originalDocumentId,
            result: verified ? "SUCCESS" : "ERROR",
            reason: verified ? undefined : currentHash ? "Hash mismatch" : "Stored object unreadable",
            metadata: { result: verified ? "INTEGRITY_VERIFIED" : "INTEGRITY_VIOLATION", registeredHash: e.originalHash, currentHash },
            requestId,
          },
          tx,
        );
      })
      .catch(mapConcurrencyError);

    if (!verified) {
      await SecurityService.record({
        type: "INTEGRITY_VIOLATION",
        userId: user.id,
        caseId: e.caseId,
        documentId: e.originalDocumentId,
        severity: "CRITICAL",
        detail: `Evidence ${e.evidenceNumber}: stored bytes do not match the registered SHA-256.`,
      });
      await notifyMany([e.currentCustodianId, e.case.investigatingOfficerId], user.id, {
        type: "INTEGRITY_WARNING",
        title: "Evidence integrity violation",
        body: `${e.evidenceNumber} failed integrity verification. Review immediately.`,
        relatedCaseId: e.caseId,
        relatedEvidenceId: e.id,
      });
    }

    return {
      status: verified ? ("VERIFIED" as const) : ("VIOLATION" as const),
      label: verified ? "INTEGRITY VERIFIED" : "INTEGRITY VIOLATION",
      registeredHash: e.originalHash,
      currentHash,
      verifiedAt,
      message: verified
        ? "The SHA-256 of the stored bytes matches the hash registered for this evidence. This confirms the bytes are unchanged; it is not by itself a determination of legal admissibility."
        : currentHash
          ? "The SHA-256 of the stored bytes does NOT match the registered hash. The stored content has changed since registration."
          : "The stored object could not be read, so its integrity cannot be confirmed.",
    };
  },

  /** Recomputes and checks every link of the custody hash chain. */
  async verifyCustodyChain(user: AuthenticatedUser, evidenceId: string, requestId: string) {
    const { e, perms } = await authorizeView(user, evidenceId, requestId, "CUSTODY_CHAIN_VERIFIED");
    if (!perms.has("evidence.verify")) {
      throw await deny(user, e, "CUSTODY_CHAIN_VERIFIED", "Missing evidence.verify", requestId, ApiError.forbidden("EVIDENCE_ACCESS_DENIED", "You may not verify this evidence."));
    }
    const events = await prisma.custodyEvent.findMany({ where: { evidenceId: e.id }, orderBy: { sequence: "asc" } });
    const verification = verifyCustodyChain(events, { custodyHeadHash: e.custodyHeadHash, custodyEventCount: e.custodyEventCount });
    const ok = verification.status === "VERIFIED";

    await audit({
      ...actorOf(user),
      action: ok ? "CUSTODY_CHAIN_VERIFIED" : "CUSTODY_CHAIN_INTEGRITY_FAILED",
      resource: `evidence:${e.id}`,
      caseId: e.caseId,
      evidenceId: e.id,
      result: ok ? "SUCCESS" : "ERROR",
      metadata: {
        eventsChecked: verification.eventsChecked,
        failureCount: verification.failures.length,
        firstFailedSequence: verification.failures[0]?.sequence ?? null,
        failureCodes: [...new Set(verification.failures.map((f) => f.code))],
      },
      requestId,
    });
    if (!ok) {
      await SecurityService.record({
        type: "INTEGRITY_VIOLATION",
        userId: user.id,
        caseId: e.caseId,
        severity: "CRITICAL",
        detail: `Evidence ${e.evidenceNumber}: custody chain verification failed (${verification.failures.length} issue(s)).`,
      });
    }
    return {
      ...verification,
      label: ok ? "CUSTODY CHAIN VERIFIED" : "CUSTODY CHAIN INTEGRITY VIOLATION",
      verifiedAt: new Date(),
      message: ok
        ? "Every custody event links to its predecessor and matches its recorded hash. This shows the recorded history has not been altered within the application database; it does not by itself establish legal admissibility."
        : "The custody history no longer matches its hash chain. One or more events were altered, removed or reordered after being recorded.",
    };
  },

  /** Transfers waiting for the current user to receive. */
  async incomingTransfers(user: AuthenticatedUser) {
    const transfers = await prisma.evidenceTransfer.findMany({
      where: { toCustodianId: user.id, status: "PENDING", evidence: { deletedAt: null, case: { organizationId: user.organizationId } } },
      orderBy: { initiatedAt: "desc" },
      include: {
        evidence: { select: { id: true, evidenceNumber: true, title: true, caseId: true, case: { select: { caseNumber: true } } } },
        fromCustodian: userSummary,
      },
    });
    return transfers.map((t) => ({
      id: t.id,
      evidence: t.evidence,
      fromCustodian: t.fromCustodian,
      reason: t.reason,
      initiatedAt: t.initiatedAt,
    }));
  },

  /** Used by global search: true only when the user may view this item. */
  async isVisibleTo(user: AuthenticatedUser, evidence: { confidentiality: string; submittedAt: Date | null; case: CaseAccessRecord }) {
    const ctx = await accessContext(user, evidence.case);
    return canViewEvidence(evidence, await ctx.permsFor(evidence.confidentiality), ctx.courtOnly);
  },

  async getDtoById(user: AuthenticatedUser, evidenceId: string) {
    const e = await loadEvidenceOrThrow(evidenceId);
    const ctx = await accessContext(user, e.case);
    const perms = await ctx.permsFor(e.confidentiality);
    return toDto(user, e, perms, ctx.courtOnly);
  },
};
