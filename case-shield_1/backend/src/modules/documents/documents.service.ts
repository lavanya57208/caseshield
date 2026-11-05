import { prisma } from "@/lib/prisma";
import { sha256 } from "@/lib/hash";
import { ApiError } from "@/lib/errors";
import { generateDocumentNumber } from "@/lib/ids";
import { AuditService } from "@/modules/audit/audit.service";
import { SecurityService } from "@/modules/security/security.service";
import { AuthenticatedUser } from "@/middleware/auth";
import { can, hasCaseAccess } from "@/lib/authorization";
import { PERMISSIONS } from "@/lib/permissions";
import { getStorageProvider, buildStorageKey } from "@/modules/storage";
import { validateUploadedFile } from "@/modules/documents/file-validation";
import { UploadDocumentMetaSchema, ListDocumentsQuerySchema } from "@/modules/documents/documents.schemas";
import { IntelligenceService } from "@/modules/ai/intelligence/intelligence.service";
import { z } from "zod";

async function loadCaseOrThrow(caseId: string) {
  const c = await prisma.case.findFirst({ where: { id: caseId, deletedAt: null } });
  if (!c) throw ApiError.notFound("Case");
  return c;
}

export async function loadDocumentOrThrow(documentId: string) {
  const doc = await prisma.document.findFirst({
    where: { id: documentId, deletedAt: null },
    include: {
      versions: { orderBy: { versionNumber: "desc" }, include: { uploader: { select: { id: true, fullName: true } } } },
      case: true,
    },
  });
  if (!doc) throw ApiError.notFound("Document");
  return doc;
}

export const DocumentsService = {
  async upload(
    user: AuthenticatedUser,
    meta: z.infer<typeof UploadDocumentMetaSchema>,
    file: { originalname: string; mimetype: string; size: number; buffer: Buffer },
    requestId: string,
  ) {
    const caseRecord = await loadCaseOrThrow(meta.caseId);

    const authz = await can(user, PERMISSIONS.DOCUMENT_UPLOAD, { case: caseRecord });
    if (!authz.allowed) {
      await AuditService.record({
        actorId: user.id,
        actorRole: user.roles[0],
        action: "DOCUMENT_UPLOADED",
        resource: "document",
        caseId: caseRecord.id,
        result: "DENIED",
        reason: authz.reason,
        requestId,
      });
      throw ApiError.forbidden("DOCUMENT_ACCESS_DENIED", authz.reason);
    }

    // 1. Validate file (extension/MIME/size/signature/malware-scan hook).
    validateUploadedFile(file);

    // 2. Compute SHA-256 over the exact bytes being stored.
    const hash = sha256(file.buffer);

    // 3. Register metadata + store the object inside one transaction-safe flow.
    const documentNumber = await generateDocumentNumber();
    const storageProvider = getStorageProvider();

    const document = await prisma.$transaction(async (tx) => {
      const doc = await tx.document.create({
        data: {
          documentNumber,
          caseId: caseRecord.id,
          type: meta.type,
          title: meta.title,
          description: meta.description,
          confidentiality: meta.confidentiality,
          status: "REGISTERED",
          createdBy: user.id,
          tags: { create: meta.tags.map((tag) => ({ tag })) },
        },
      });

      const storageKey = buildStorageKey(caseRecord.id, doc.id, "v1", file.originalname);
      await storageProvider.put(storageKey, file.buffer, file.mimetype);

      const version = await tx.documentVersion.create({
        data: {
          documentId: doc.id,
          versionNumber: 1,
          fileName: file.originalname,
          fileSize: file.size,
          mimeType: file.mimetype,
          sha256Hash: hash,
          storageProvider: storageProvider.id,
          storageKey,
          integrityStatus: "VERIFIED",
          lastVerifiedAt: new Date(),
          uploadedBy: user.id,
        },
      });

      await tx.document.update({ where: { id: doc.id }, data: { currentVersionId: version.id } });
      await tx.digitalSignature.create({ data: { documentId: doc.id, versionId: version.id, status: "NOT_SIGNED" } });
      await tx.case.update({ where: { id: caseRecord.id }, data: { lastActivityAt: new Date() } });

      await AuditService.record(
        {
          actorId: user.id,
          actorRole: user.roles[0],
          action: "DOCUMENT_UPLOADED",
          resource: `document:${doc.id}`,
          caseId: caseRecord.id,
          documentId: doc.id,
          result: "SUCCESS",
          requestId,
        },
        tx,
      );

      // Phase 4: queue OCR/AI processing. The upload never waits for it.
      const processing = await IntelligenceService.createQueuedRecords(tx, {
        documentId: doc.id,
        versionId: version.id,
        caseId: caseRecord.id,
        requestedById: user.id,
        requestId,
        actorRole: user.roles[0],
      });

      return { ...doc, currentVersion: version, processing };
    });

    const { processing, ...result } = document;
    IntelligenceService.enqueue(processing);
    return { ...result, intelligence: { id: processing.intelligenceId, jobId: processing.jobId, processingStatus: "QUEUED" as const } };
  },

  async list(user: AuthenticatedUser, query: z.infer<typeof ListDocumentsQuerySchema>) {
    const caseRecord = await loadCaseOrThrow(query.caseId);
    const authz = await can(user, PERMISSIONS.DOCUMENT_VIEW, { case: caseRecord });
    if (!authz.allowed) throw ApiError.forbidden("DOCUMENT_ACCESS_DENIED", authz.reason);

    const where = { caseId: query.caseId, deletedAt: null, type: query.type };
    const [items, total] = await Promise.all([
      prisma.document.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          versions: { orderBy: { versionNumber: "desc" }, take: 1, include: { uploader: { select: { id: true, fullName: true } } } },
          tags: true,
        },
      }),
      prisma.document.count({ where }),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  },

  async getById(user: AuthenticatedUser, documentId: string, requestId: string) {
    const doc = await loadDocumentOrThrow(documentId);
    const authz = await can(user, PERMISSIONS.DOCUMENT_VIEW, { case: doc.case, document: doc });
    if (!authz.allowed) {
      await AuditService.record({
        actorId: user.id,
        actorRole: user.roles[0],
        action: "DOCUMENT_VIEWED",
        resource: `document:${documentId}`,
        caseId: doc.caseId,
        documentId,
        result: "DENIED",
        reason: authz.reason,
        requestId,
      });
      throw ApiError.forbidden("DOCUMENT_ACCESS_DENIED", authz.reason);
    }

    await AuditService.record({
      actorId: user.id,
      actorRole: user.roles[0],
      action: "DOCUMENT_VIEWED",
      resource: `document:${documentId}`,
      caseId: doc.caseId,
      documentId,
      result: "SUCCESS",
      requestId,
    });

    const [signatures, auditCount] = await Promise.all([
      prisma.digitalSignature.findMany({ where: { documentId }, orderBy: { createdAt: "desc" } }),
      prisma.auditEvent.count({ where: { documentId } }),
    ]);

    return { ...doc, signatures, auditEventCount: auditCount };
  },

  async versions(user: AuthenticatedUser, documentId: string) {
    const doc = await loadDocumentOrThrow(documentId);
    const authz = await can(user, PERMISSIONS.DOCUMENT_VIEW, { case: doc.case, document: doc });
    if (!authz.allowed) throw ApiError.forbidden("DOCUMENT_ACCESS_DENIED", authz.reason);
    return doc.versions;
  },

  async addVersion(
    user: AuthenticatedUser,
    documentId: string,
    changeNote: string,
    file: { originalname: string; mimetype: string; size: number; buffer: Buffer },
    requestId: string,
  ) {
    const doc = await loadDocumentOrThrow(documentId);
    const authz = await can(user, PERMISSIONS.DOCUMENT_VERSION, { case: doc.case, document: doc });
    if (!authz.allowed) throw ApiError.forbidden("DOCUMENT_ACCESS_DENIED", authz.reason);

    validateUploadedFile(file);
    const hash = sha256(file.buffer);
    const nextVersionNumber = (doc.versions[0]?.versionNumber ?? 0) + 1;
    const storageProvider = getStorageProvider();
    const storageKey = buildStorageKey(doc.caseId, doc.id, `v${nextVersionNumber}`, file.originalname);
    await storageProvider.put(storageKey, file.buffer, file.mimetype);

    const version = await prisma.$transaction(async (tx) => {
      const v = await tx.documentVersion.create({
        data: {
          documentId: doc.id,
          versionNumber: nextVersionNumber,
          fileName: file.originalname,
          fileSize: file.size,
          mimeType: file.mimetype,
          sha256Hash: hash,
          storageProvider: storageProvider.id,
          storageKey,
          changeNote,
          integrityStatus: "VERIFIED",
          lastVerifiedAt: new Date(),
          uploadedBy: user.id,
        },
      });
      await tx.document.update({ where: { id: doc.id }, data: { currentVersionId: v.id } });
      await tx.digitalSignature.create({ data: { documentId: doc.id, versionId: v.id, status: "NOT_SIGNED" } });
      await AuditService.record(
        {
          actorId: user.id,
          actorRole: user.roles[0],
          action: "DOCUMENT_VERSION_CREATED",
          resource: `document:${doc.id}`,
          caseId: doc.caseId,
          documentId: doc.id,
          result: "SUCCESS",
          requestId,
        },
        tx,
      );
      const processing = await IntelligenceService.createQueuedRecords(tx, {
        documentId: doc.id,
        versionId: v.id,
        caseId: doc.caseId,
        requestedById: user.id,
        requestId,
        actorRole: user.roles[0],
      });
      return { v, processing };
    });

    IntelligenceService.enqueue(version.processing);
    return { ...version.v, intelligence: { id: version.processing.intelligenceId, jobId: version.processing.jobId, processingStatus: "QUEUED" as const } };
  },

  async download(user: AuthenticatedUser, documentId: string, requestId: string) {
    const doc = await loadDocumentOrThrow(documentId);
    const authz = await can(user, PERMISSIONS.DOCUMENT_DOWNLOAD, { case: doc.case, document: doc });

    if (!authz.allowed) {
      await AuditService.record({
        actorId: user.id,
        actorRole: user.roles[0],
        action: "DOWNLOAD_DENIED",
        resource: `document:${documentId}`,
        caseId: doc.caseId,
        documentId,
        result: "DENIED",
        reason: authz.reason,
        requestId,
      });
      throw ApiError.forbidden("DOCUMENT_ACCESS_DENIED", authz.reason);
    }

    const currentVersion = doc.versions[0];
    if (!currentVersion) throw ApiError.notFound("Document version");

    const buffer = await getStorageProvider().get(currentVersion.storageKey);

    await AuditService.record({
      actorId: user.id,
      actorRole: user.roles[0],
      action: "DOCUMENT_DOWNLOADED",
      resource: `document:${documentId}`,
      caseId: doc.caseId,
      documentId,
      result: "SUCCESS",
      metadata: { variant: "original", versionNumber: currentVersion.versionNumber },
      requestId,
    });

    return { buffer, fileName: currentVersion.fileName, mimeType: currentVersion.mimeType };
  },

  async verify(user: AuthenticatedUser, documentId: string, versionNumber: number | undefined, requestId: string) {
    const doc = await loadDocumentOrThrow(documentId);
    const authz = await can(user, PERMISSIONS.DOCUMENT_VERIFY, { case: doc.case, document: doc });
    if (!authz.allowed) throw ApiError.forbidden("DOCUMENT_ACCESS_DENIED", authz.reason);

    const version = versionNumber
      ? doc.versions.find((v) => v.versionNumber === versionNumber)
      : doc.versions[0];
    if (!version) throw ApiError.notFound("Document version");

    const buffer = await getStorageProvider().get(version.storageKey);
    const currentHash = sha256(buffer);
    const status = currentHash === version.sha256Hash ? "VERIFIED" : "VIOLATION";

    await prisma.documentVersion.update({
      where: { id: version.id },
      data: { integrityStatus: status, lastVerifiedAt: new Date() },
    });

    await AuditService.record({
      actorId: user.id,
      actorRole: user.roles[0],
      action: "INTEGRITY_VERIFIED",
      resource: `document:${documentId}`,
      caseId: doc.caseId,
      documentId,
      result: status === "VERIFIED" ? "SUCCESS" : "ERROR",
      reason: status === "VIOLATION" ? "Hash mismatch" : undefined,
      requestId,
    });

    if (status === "VIOLATION") {
      await AuditService.record({
        actorId: user.id,
        actorRole: user.roles[0],
        action: "INTEGRITY_VIOLATION",
        resource: `document:${documentId}`,
        caseId: doc.caseId,
        documentId,
        result: "ERROR",
        requestId,
      });
      await SecurityService.record({
        type: "INTEGRITY_VIOLATION",
        userId: user.id,
        caseId: doc.caseId,
        documentId,
        severity: "CRITICAL",
        detail: `Hash mismatch detected on ${doc.documentNumber} v${version.versionNumber}.`,
      });
    }

    return {
      status,
      registeredHash: version.sha256Hash,
      currentHash,
      versionNumber: version.versionNumber,
      message:
        status === "VERIFIED"
          ? "The calculated file hash matches the registered hash for this document version."
          : "The calculated file hash does not match the registered hash for this document version.",
    };
  },
};
