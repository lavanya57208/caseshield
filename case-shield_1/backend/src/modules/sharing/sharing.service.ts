import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/errors";
import { can } from "@/lib/authorization";
import { PERMISSIONS, ROLE_BASELINE_PERMISSIONS } from "@/lib/permissions";
import { AuthenticatedUser } from "@/middleware/auth";
import { AuditService } from "@/modules/audit/audit.service";
import { SecurityService } from "@/modules/security/security.service";
import { NotificationsService } from "@/modules/notifications/notifications.service";
import { loadDocumentOrThrow } from "@/modules/documents/documents.service";
import { PrivacyService, readVerifiedDerivative, readVerifiedVersion } from "@/modules/privacy/privacy.service";
import { evaluateShareAccess, validateShareWindow, ShareAccessMode } from "@/modules/sharing/share-policy";
import { purposeLabel, SharePurposeKey } from "@/modules/sharing/share-purposes";
import { CreateShareSchema, ListSharesQuerySchema } from "@/modules/sharing/sharing.schemas";

// Controlled, purpose-bound, time-limited sharing — see
// docs/security-architecture.md §Controlled Sharing.
//
// A share does NOT create a DocumentPermission and does NOT give the
// recipient access to the original object. The recipient can only reach the
// document through /api/shares/:id/{view,download}, which re-evaluate the
// share policy on every call and serve a derivative produced for them
// (redacted and/or watermarked as the share requires).

const HIGH_SENSITIVITY = new Set(["RESTRICTED", "HIGHLY_CONFIDENTIAL"]);
const APPROVER_ROLE_KEYS = Object.entries(ROLE_BASELINE_PERMISSIONS)
  .filter(([, perms]) => perms.includes(PERMISSIONS.ACCESS_APPROVE))
  .map(([role]) => role);

const shareInclude = {
  document: { select: { id: true, documentNumber: true, title: true, type: true, confidentiality: true } },
  case: { select: { id: true, caseNumber: true, title: true, organizationId: true } },
  sourceVersion: { select: { versionNumber: true, fileName: true, mimeType: true } },
  requestedBy: { select: { id: true, fullName: true } },
  recipient: { select: { id: true, fullName: true, department: true } },
  reviewedBy: { select: { id: true, fullName: true } },
  revokedBy: { select: { id: true, fullName: true } },
  _count: { select: { deliveredCopies: true } },
} satisfies Prisma.DocumentShareInclude;

type ShareWithRelations = Prisma.DocumentShareGetPayload<{ include: typeof shareInclude }>;

function actor(user: AuthenticatedUser | null) {
  return { actorId: user?.id ?? null, actorRole: user?.roles[0] ?? null };
}

function recipientLabel(share: { recipientOrganization: string | null; recipient: { fullName: string } }) {
  return share.recipientOrganization ? `${share.recipientOrganization} (${share.recipient.fullName})` : share.recipient.fullName;
}

function shareAuditMetadata(share: {
  id: string;
  purpose: string;
  recipientUserId: string;
  recipientOrganization: string | null;
  expiresAt: Date;
}) {
  return {
    shareId: share.id,
    purpose: share.purpose,
    recipientUserId: share.recipientUserId,
    recipientOrganization: share.recipientOrganization,
    expiresAt: share.expiresAt.toISOString(),
  };
}

function presentShare(share: ShareWithRelations, viewer?: AuthenticatedUser) {
  const now = new Date();
  const effectiveStatus = share.status === "APPROVED" && now >= share.expiresAt ? "EXPIRED" : share.status;
  let access: { canView: boolean; canDownload: boolean; reason?: string } | undefined;
  if (viewer && viewer.id === share.recipientUserId) {
    const policyShare = { ...share, organizationId: share.case.organizationId };
    const view = evaluateShareAccess(policyShare, viewer, "view", now);
    const download = evaluateShareAccess(policyShare, viewer, "download", now);
    access = {
      canView: view.allowed,
      canDownload: download.allowed,
      reason: !view.allowed ? view.message : !download.allowed ? download.message : undefined,
    };
  }
  return {
    id: share.id,
    documentId: share.documentId,
    caseId: share.caseId,
    sourceVersionId: share.sourceVersionId,
    sourceVersionNumber: share.sourceVersion.versionNumber,
    document: share.document,
    case: { id: share.case.id, caseNumber: share.case.caseNumber, title: share.case.title },
    requestedBy: share.requestedBy,
    recipient: share.recipient,
    recipientOrganization: share.recipientOrganization,
    purpose: share.purpose,
    purposeLabel: purposeLabel(share.purpose as SharePurposeKey, share.purposeNote),
    purposeNote: share.purposeNote,
    startsAt: share.startsAt,
    expiresAt: share.expiresAt,
    allowDownload: share.allowDownload,
    applyRedaction: share.applyRedaction,
    baseDerivativeId: share.baseDerivativeId,
    applyWatermark: share.applyWatermark,
    requireApproval: share.requireApproval,
    status: effectiveStatus,
    reviewedBy: share.reviewedBy,
    reviewedAt: share.reviewedAt,
    reviewNote: share.reviewNote,
    revokedBy: share.revokedBy,
    revokedAt: share.revokedAt,
    createdAt: share.createdAt,
    deliveredCopies: share._count.deliveredCopies,
    access,
  };
}

/**
 * Moves APPROVED shares whose expiry has passed to EXPIRED and records one
 * SHARE_ACCESS_EXPIRED event per share. Expiry is ENFORCED by the policy
 * check regardless; this only keeps stored status and the audit trail
 * accurate. Safe to call repeatedly (conditional update).
 */
async function expireDueShares(where: Prisma.DocumentShareWhereInput, requestId: string, triggeredBy: AuthenticatedUser | null) {
  const due = await prisma.documentShare.findMany({
    where: { ...where, status: "APPROVED", expiresAt: { lte: new Date() } },
    select: { id: true, caseId: true, documentId: true, purpose: true, recipientUserId: true, recipientOrganization: true, expiresAt: true },
    take: 200,
  });
  for (const share of due) {
    const updated = await prisma.documentShare.updateMany({ where: { id: share.id, status: "APPROVED" }, data: { status: "EXPIRED" } });
    if (updated.count === 1) {
      await AuditService.record({
        ...actor(triggeredBy),
        action: "SHARE_ACCESS_EXPIRED",
        resource: `share:${share.id}`,
        caseId: share.caseId,
        documentId: share.documentId,
        reason: "Share reached its expiry time.",
        metadata: shareAuditMetadata(share),
        requestId,
      });
    }
  }
}

async function loadShareOrThrow(id: string) {
  const share = await prisma.documentShare.findUnique({ where: { id }, include: shareInclude });
  if (!share) throw ApiError.notFound("Share");
  return share;
}

async function canReview(user: AuthenticatedUser, share: ShareWithRelations) {
  const doc = await loadDocumentOrThrow(share.documentId);
  const authz = await can(user, PERMISSIONS.ACCESS_APPROVE, { case: doc.case, document: doc });
  return authz.allowed;
}

async function recordAttempt(
  user: AuthenticatedUser,
  share: { id: string; caseId: string; documentId: string },
  action: string,
  reason: string,
  requestId: string,
  extra: Record<string, string | null> = {},
) {
  await AuditService.record({
    ...actor(user),
    action,
    resource: `share:${share.id}`,
    caseId: share.caseId,
    documentId: share.documentId,
    result: "DENIED",
    reason,
    metadata: { shareId: share.id, organizationId: user.organizationId, ...extra },
    requestId,
  });
}

async function notifyApprovers(share: ShareWithRelations, requester: AuthenticatedUser) {
  const approvers = await prisma.user.findMany({
    where: {
      organizationId: share.case.organizationId,
      status: "ACTIVE",
      deletedAt: null,
      id: { not: requester.id },
      userRoles: { some: { role: { key: { in: APPROVER_ROLE_KEYS } } } },
    },
    select: { id: true },
  });
  await Promise.all(
    approvers.map((a) =>
      NotificationsService.send({
        userId: a.id,
        type: "PENDING_ACTION",
        title: "Secure share awaiting approval",
        body: `${requester.fullName} requested to share ${share.document.documentNumber} (${purposeLabel(share.purpose as SharePurposeKey, null)}) on ${share.case.caseNumber}.`,
        relatedCaseId: share.caseId,
        relatedDocumentId: share.documentId,
      }),
    ),
  );
}

async function notifyRecipient(share: ShareWithRelations) {
  await NotificationsService.send({
    userId: share.recipientUserId,
    type: "DOCUMENT_SHARED",
    title: "A document was shared with you",
    body: `${share.document.documentNumber} was shared with you for ${purposeLabel(share.purpose as SharePurposeKey, null)} until ${share.expiresAt.toISOString().slice(0, 10)}.`,
    relatedCaseId: share.caseId,
    relatedDocumentId: share.documentId,
  });
}

async function recordGrant(approver: AuthenticatedUser, share: ShareWithRelations, requestId: string, note: string | null, autoApproved: boolean) {
  await AuditService.record({
    ...actor(approver),
    action: "SHARE_REQUEST_APPROVED",
    resource: `share:${share.id}`,
    caseId: share.caseId,
    documentId: share.documentId,
    reason: note,
    metadata: { ...shareAuditMetadata(share), autoApproved },
    requestId,
  });
  await AuditService.record({
    ...actor(approver),
    action: "SHARE_ACCESS_GRANTED",
    resource: `share:${share.id}`,
    caseId: share.caseId,
    documentId: share.documentId,
    metadata: {
      ...shareAuditMetadata(share),
      startsAt: share.startsAt.toISOString(),
      allowDownload: share.allowDownload,
      applyRedaction: share.applyRedaction,
      applyWatermark: share.applyWatermark,
    },
    requestId,
  });
}

export const SharingService = {
  async eligibleRecipients(user: AuthenticatedUser, documentId: string) {
    const doc = await loadDocumentOrThrow(documentId);
    const authz = await can(user, PERMISSIONS.DOCUMENT_SHARE, { case: doc.case, document: doc });
    if (!authz.allowed) throw ApiError.forbidden("DOCUMENT_ACCESS_DENIED", authz.reason);
    const users = await prisma.user.findMany({
      where: { organizationId: doc.case.organizationId, status: "ACTIVE", deletedAt: null, id: { not: user.id } },
      include: { userRoles: { include: { role: true } }, organization: true },
      orderBy: { fullName: "asc" },
    });
    return users.map((u) => ({
      id: u.id,
      fullName: u.fullName,
      department: u.department,
      organization: u.organization.name,
      roles: u.userRoles.map((ur) => ({ key: ur.role.key, name: ur.role.name })),
    }));
  },

  async create(user: AuthenticatedUser, input: z.infer<typeof CreateShareSchema>, requestId: string) {
    const doc = await loadDocumentOrThrow(input.documentId);

    const authz = await can(user, PERMISSIONS.DOCUMENT_SHARE, { case: doc.case, document: doc });
    if (!authz.allowed) {
      await AuditService.record({
        ...actor(user),
        action: "SHARE_REQUEST_CREATED",
        resource: `document:${doc.id}`,
        caseId: doc.caseId,
        documentId: doc.id,
        result: "DENIED",
        reason: authz.reason,
        metadata: { purpose: input.purpose, recipientUserId: input.recipientUserId, organizationId: user.organizationId },
        requestId,
      });
      throw ApiError.forbidden("SHARE_DENIED", authz.reason ?? "You are not permitted to share this document.");
    }

    if (input.recipientUserId === user.id) throw ApiError.badRequest("INVALID_RECIPIENT", "You cannot share a document with yourself.");
    const recipient = await prisma.user.findFirst({
      where: { id: input.recipientUserId, organizationId: doc.case.organizationId, status: "ACTIVE", deletedAt: null },
    });
    if (!recipient) {
      throw ApiError.badRequest("INVALID_RECIPIENT", "The recipient must be an active user in the case's organization.");
    }

    const now = new Date();
    const startsAt = input.startsAt ?? now;
    const windowError = validateShareWindow(startsAt, input.expiresAt, now);
    if (windowError) throw ApiError.badRequest("INVALID_SHARE_WINDOW", windowError);

    const version = doc.versions[0];
    if (!version) throw ApiError.notFound("Document version");
    if (version.integrityStatus === "VIOLATION") {
      throw ApiError.conflict("INTEGRITY_VIOLATION", "The current version has a recorded integrity violation and cannot be shared.");
    }

    let baseDerivativeId: string | null = null;
    if (input.applyRedaction) {
      const redacted = await prisma.documentDerivative.findFirst({
        where: { id: input.redactedDerivativeId, documentId: doc.id, type: "REDACTED", status: "COMPLETED" },
      });
      if (!redacted) throw ApiError.badRequest("INVALID_DERIVATIVE", "The redacted copy was not found for this document.");
      if (redacted.sourceVersionId !== version.id) {
        throw ApiError.badRequest("STALE_DERIVATIVE", "The redacted copy was made from an older version. Scan and redact the current version.");
      }
      baseDerivativeId = redacted.id;
    }

    // Server-side policy — the client's choices can only make a share
    // stricter, never looser.
    const policyAdjustments: string[] = [];
    let applyWatermark = input.applyWatermark;
    let requireApproval = input.requireApproval;
    if (!input.allowDownload && !applyWatermark) {
      applyWatermark = true;
      policyAdjustments.push("View-only shares are always watermarked.");
    }
    if (HIGH_SENSITIVITY.has(doc.confidentiality) && !requireApproval) {
      requireApproval = true;
      policyAdjustments.push(`${doc.confidentiality.replace(/_/g, " ")} documents always require approval.`);
    }

    const created = await prisma.documentShare.create({
      data: {
        documentId: doc.id,
        caseId: doc.caseId,
        sourceVersionId: version.id,
        requestedById: user.id,
        recipientUserId: recipient.id,
        recipientOrganization: input.recipientOrganization ?? null,
        purpose: input.purpose,
        purposeNote: input.purposeNote ?? null,
        startsAt,
        expiresAt: input.expiresAt,
        allowDownload: input.allowDownload,
        applyRedaction: input.applyRedaction,
        baseDerivativeId,
        applyWatermark,
        requireApproval,
        status: requireApproval ? "PENDING" : "APPROVED",
        reviewedById: requireApproval ? null : user.id,
        reviewedAt: requireApproval ? null : now,
        reviewNote: requireApproval ? null : "Approval not required; approved on creation by an authorized sharer.",
      },
      include: shareInclude,
    });

    await AuditService.record({
      ...actor(user),
      action: "SHARE_REQUEST_CREATED",
      resource: `share:${created.id}`,
      caseId: doc.caseId,
      documentId: doc.id,
      metadata: {
        ...shareAuditMetadata(created),
        organizationId: user.organizationId,
        startsAt: startsAt.toISOString(),
        allowDownload: created.allowDownload,
        applyRedaction: created.applyRedaction,
        baseDerivativeId,
        applyWatermark,
        requireApproval,
        policyAdjustments,
      },
      requestId,
    });

    if (requireApproval) {
      await notifyApprovers(created, user);
    } else {
      await recordGrant(user, created, requestId, null, true);
      await notifyRecipient(created);
    }

    return { share: presentShare(created, user), policyAdjustments };
  },

  async list(user: AuthenticatedUser, query: z.infer<typeof ListSharesQuerySchema>, requestId: string) {
    let where: Prisma.DocumentShareWhereInput;
    switch (query.scope) {
      case "incoming":
        where = { recipientUserId: user.id };
        break;
      case "outgoing":
        where = { requestedById: user.id };
        break;
      case "document": {
        if (!query.documentId) throw ApiError.badRequest("VALIDATION_ERROR", "documentId is required for scope=document.");
        const doc = await loadDocumentOrThrow(query.documentId);
        const authz = await can(user, PERMISSIONS.DOCUMENT_VIEW, { case: doc.case, document: doc });
        if (!authz.allowed) throw ApiError.forbidden("DOCUMENT_ACCESS_DENIED", authz.reason);
        where = { documentId: doc.id };
        break;
      }
      case "approvals":
        where = { status: "PENDING", case: { organizationId: user.organizationId }, requestedById: { not: user.id } };
        break;
    }

    await expireDueShares(where, requestId, null);
    const rows = await prisma.documentShare.findMany({
      where: { ...where, status: query.status ?? (where.status as any) },
      include: shareInclude,
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    let visible = rows;
    if (query.scope === "approvals") {
      const checks = await Promise.all(rows.map((r) => canReview(user, r)));
      visible = rows.filter((_, i) => checks[i]);
    }
    return visible.map((s) => presentShare(s, user));
  },

  async get(user: AuthenticatedUser, id: string, requestId: string) {
    await expireDueShares({ id }, requestId, null);
    const share = await loadShareOrThrow(id);
    const involved = share.recipientUserId === user.id || share.requestedById === user.id;
    if (!involved) {
      const doc = await loadDocumentOrThrow(share.documentId);
      const authz = await can(user, PERMISSIONS.DOCUMENT_VIEW, { case: doc.case, document: doc });
      if (!authz.allowed) {
        await recordAttempt(user, share, "UNAUTHORIZED_ACCESS_ATTEMPT", "Attempted to read a share the user is not party to.", requestId);
        throw ApiError.forbidden("ACCESS_DENIED", "You do not have access to this share.");
      }
    }
    return presentShare(share, user);
  },

  async approve(user: AuthenticatedUser, id: string, note: string | undefined, requestId: string) {
    const share = await loadShareOrThrow(id);
    if (share.requestedById === user.id) {
      await recordAttempt(user, share, "SHARE_REQUEST_APPROVED", "Requester cannot approve their own share.", requestId);
      throw ApiError.forbidden("SEPARATION_OF_DUTIES", "You cannot approve a share you requested.");
    }
    if (!(await canReview(user, share))) {
      await recordAttempt(user, share, "SHARE_REQUEST_APPROVED", "Missing access.approve on this case.", requestId);
      throw ApiError.forbidden("ACCESS_DENIED", "You are not permitted to approve shares on this case.");
    }
    if (share.status !== "PENDING") throw ApiError.conflict("ALREADY_REVIEWED", "This share request has already been reviewed.");
    if (new Date() >= share.expiresAt) {
      await prisma.documentShare.update({ where: { id }, data: { status: "EXPIRED" } });
      await AuditService.record({
        ...actor(user),
        action: "SHARE_ACCESS_EXPIRED",
        resource: `share:${id}`,
        caseId: share.caseId,
        documentId: share.documentId,
        reason: "Expired before approval.",
        metadata: shareAuditMetadata(share),
        requestId,
      });
      throw ApiError.conflict("SHARE_EXPIRED", "This share request expired before it was approved.");
    }

    const updated = await prisma.documentShare.update({
      where: { id },
      data: { status: "APPROVED", reviewedById: user.id, reviewedAt: new Date(), reviewNote: note ?? null },
      include: shareInclude,
    });
    await recordGrant(user, updated, requestId, note ?? null, false);
    await notifyRecipient(updated);
    await NotificationsService.send({
      userId: updated.requestedById,
      type: "ACCESS_APPROVED",
      title: "Secure share approved",
      body: `Your share of ${updated.document.documentNumber} was approved.`,
      relatedCaseId: updated.caseId,
      relatedDocumentId: updated.documentId,
    });
    return presentShare(updated, user);
  },

  async reject(user: AuthenticatedUser, id: string, note: string | undefined, requestId: string) {
    const share = await loadShareOrThrow(id);
    if (!(await canReview(user, share)) || share.requestedById === user.id) {
      await recordAttempt(user, share, "SHARE_REQUEST_REJECTED", "Not permitted to review this share.", requestId);
      throw ApiError.forbidden("ACCESS_DENIED", "You are not permitted to review this share.");
    }
    if (share.status !== "PENDING") throw ApiError.conflict("ALREADY_REVIEWED", "This share request has already been reviewed.");

    const updated = await prisma.documentShare.update({
      where: { id },
      data: { status: "REJECTED", reviewedById: user.id, reviewedAt: new Date(), reviewNote: note ?? null },
      include: shareInclude,
    });
    await AuditService.record({
      ...actor(user),
      action: "SHARE_REQUEST_REJECTED",
      resource: `share:${id}`,
      caseId: share.caseId,
      documentId: share.documentId,
      reason: note ?? null,
      metadata: shareAuditMetadata(share),
      requestId,
    });
    await NotificationsService.send({
      userId: share.requestedById,
      type: "ACCESS_REJECTED",
      title: "Secure share rejected",
      body: `Your share of ${share.document.documentNumber} was rejected.`,
      relatedCaseId: share.caseId,
      relatedDocumentId: share.documentId,
    });
    return presentShare(updated, user);
  },

  async revoke(user: AuthenticatedUser, id: string, note: string | undefined, requestId: string) {
    const share = await loadShareOrThrow(id);
    let allowed = share.requestedById === user.id;
    if (!allowed) {
      const doc = await loadDocumentOrThrow(share.documentId);
      const [revoke, approve] = await Promise.all([
        can(user, PERMISSIONS.ACCESS_REVOKE, { case: doc.case, document: doc }),
        can(user, PERMISSIONS.ACCESS_APPROVE, { case: doc.case, document: doc }),
      ]);
      allowed = revoke.allowed || approve.allowed;
    }
    if (!allowed) {
      await recordAttempt(user, share, "SHARE_ACCESS_REVOKED", "Not permitted to revoke this share.", requestId);
      throw ApiError.forbidden("ACCESS_DENIED", "You are not permitted to revoke this share.");
    }
    if (share.status !== "PENDING" && share.status !== "APPROVED") {
      throw ApiError.conflict("NOT_ACTIVE", "Only pending or active shares can be revoked.");
    }

    const updated = await prisma.documentShare.update({
      where: { id },
      data: { status: "REVOKED", revokedAt: new Date(), revokedById: user.id },
      include: shareInclude,
    });
    await AuditService.record({
      ...actor(user),
      action: "SHARE_ACCESS_REVOKED",
      resource: `share:${id}`,
      caseId: share.caseId,
      documentId: share.documentId,
      reason: note ?? null,
      metadata: { ...shareAuditMetadata(share), previousStatus: share.status },
      requestId,
    });
    await SecurityService.record({
      type: "PERMISSION_CHANGE",
      userId: share.recipientUserId,
      caseId: share.caseId,
      documentId: share.documentId,
      severity: "LOW",
      detail: `Share of ${share.document.documentNumber} was revoked by ${user.fullName}.`,
    });
    await NotificationsService.send({
      userId: share.recipientUserId,
      type: "SECURITY_ALERT",
      title: "Shared access revoked",
      body: `Your access to ${share.document.documentNumber} was revoked.`,
      relatedCaseId: share.caseId,
      relatedDocumentId: share.documentId,
    });
    return presentShare(updated, user);
  },

  /**
   * The ONLY path by which a recipient obtains document content. Re-checks
   * the share policy on every call; never serves the stored original object.
   */
  async deliver(user: AuthenticatedUser, id: string, mode: ShareAccessMode, requestId: string) {
    const share = await loadShareOrThrow(id);
    const decision = evaluateShareAccess({ ...share, organizationId: share.case.organizationId }, user, mode);
    const deniedAction = mode === "download" ? "DOWNLOAD_DENIED" : "DOCUMENT_VIEWED";

    if (!decision.allowed) {
      if (decision.expiredTransition) await expireDueShares({ id: share.id }, requestId, null);
      if (decision.code === "NOT_RECIPIENT" || decision.code === "TENANT_MISMATCH") {
        await recordAttempt(user, share, "UNAUTHORIZED_ACCESS_ATTEMPT", decision.message, requestId, { mode });
        await SecurityService.record({
          type: "SUSPICIOUS_ACCESS",
          userId: user.id,
          caseId: share.caseId,
          documentId: share.documentId,
          severity: "MEDIUM",
          detail: `${user.fullName} attempted to ${mode} a document through a share addressed to another user.`,
        });
      } else if (decision.code === "SHARE_EXPIRED") {
        await SecurityService.record({
          type: "EXPIRED_ACCESS",
          userId: user.id,
          caseId: share.caseId,
          documentId: share.documentId,
          severity: "LOW",
          detail: `Access attempted on an expired share of ${share.document.documentNumber}.`,
        });
      }
      await recordAttempt(user, share, deniedAction, decision.message, requestId, { code: decision.code, mode, purpose: share.purpose });
      throw new ApiError(403, decision.code, decision.message);
    }

    const doc = await loadDocumentOrThrow(share.documentId);
    const version = doc.versions.find((v) => v.id === share.sourceVersionId);
    if (!version) throw ApiError.notFound("Document version");

    let base: { buffer: Buffer; mimeType: string; parentDerivativeId: string | null; fileName: string };
    if (share.applyRedaction) {
      const redacted = await prisma.documentDerivative.findFirst({
        where: { id: share.baseDerivativeId ?? undefined, documentId: doc.id, type: "REDACTED", status: "COMPLETED" },
      });
      if (!redacted || !share.baseDerivativeId) throw ApiError.conflict("DERIVATIVE_NOT_READY", "The redacted copy for this share is unavailable.");
      base = { buffer: await readVerifiedDerivative(redacted), mimeType: redacted.mimeType!, parentDerivativeId: redacted.id, fileName: redacted.fileName! };
    } else {
      base = { buffer: await readVerifiedVersion(user, doc, version, requestId), mimeType: version.mimeType, parentDerivativeId: null, fileName: version.fileName };
    }

    let file = { buffer: base.buffer, mimeType: base.mimeType, fileName: base.fileName };
    let derivativeId: string | null = base.parentDerivativeId;
    if (share.applyWatermark) {
      const produced = await PrivacyService.produceWatermarkedCopy({
        user,
        doc,
        version,
        base,
        recipient: recipientLabel(share),
        purpose: share.purpose as SharePurposeKey,
        purposeNote: share.purposeNote,
        shareId: share.id,
        requestId,
      });
      // A share that requires a watermark is never served without one.
      if (!produced.buffer || produced.derivative.status !== "COMPLETED") {
        throw ApiError.conflict("WATERMARK_UNSUPPORTED", produced.derivative.statusReason ?? "A watermarked copy could not be produced.");
      }
      file = { buffer: produced.buffer, mimeType: produced.derivative.mimeType!, fileName: produced.derivative.fileName! };
      derivativeId = produced.derivative.id;
    }

    await AuditService.record({
      ...actor(user),
      action: mode === "download" ? "DOCUMENT_DOWNLOADED" : "DOCUMENT_VIEWED",
      resource: `share:${share.id}`,
      caseId: share.caseId,
      documentId: share.documentId,
      metadata: {
        via: "share",
        shareId: share.id,
        purpose: share.purpose,
        recipientUserId: share.recipientUserId,
        derivativeId,
        redacted: share.applyRedaction,
        watermarked: share.applyWatermark,
        organizationId: user.organizationId,
      },
      requestId,
    });

    return file;
  },
};
