import { Prisma, DocumentIntelligence } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/errors";
import { AuthenticatedUser } from "@/middleware/auth";
import { can } from "@/lib/authorization";
import { PERMISSIONS } from "@/lib/permissions";
import { AuditService, AuditMetadataValue } from "@/modules/audit/audit.service";
import { DOCUMENT_CLASSIFICATION_TYPES, StructuredDocumentMetadata } from "@/modules/ai/ai-provider.types";
import { AI_OUTPUT_DISCLAIMER } from "@/modules/ai/guardrails";
import { metadataToSearchText } from "@/modules/ai/heuristics";
import { getAIProvider } from "@/modules/ai/index";
import { getOCRProvider } from "@/modules/ai/ocr";
import { getProcessingQueue, registerProcessingHandler } from "@/modules/ai/processing/processing-queue";
import { generateSummary, RESTRICTED_POLICY_REASON, runDocumentPipeline } from "@/modules/ai/processing/document-pipeline";
import { DocumentTypeEnum } from "@/modules/documents/documents.schemas";

// Document Intelligence service — see docs/document-processing.md.
//
// Every entry point authorizes with the same can() used by the rest of the
// document API BEFORE touching derived data or a provider:
//   read intelligence          → document.view
//   reprocess / summary / review → ai.process
//   apply a confirmed type to the document record → additionally document.version
// AI output is stored as a suggestion; only a human review changes its
// provenance, and nothing here ever edits the original stored file.

registerProcessingHandler(runDocumentPipeline);

const TEXT_PREVIEW_CHARS = 4000;
const ACTIVE_STATES = new Set(["QUEUED", "PROCESSING"]);

type Tx = Prisma.TransactionClient;

async function loadAuthorizedDocument(user: AuthenticatedUser, documentId: string, permission: typeof PERMISSIONS[keyof typeof PERMISSIONS], requestId: string, action: string) {
  const doc = await prisma.document.findFirst({
    where: { id: documentId, deletedAt: null },
    include: { case: true, versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
  });
  if (!doc) throw ApiError.notFound("Document");
  const authz = await can(user, permission, { case: doc.case, document: doc });
  if (!authz.allowed) {
    await AuditService.record({
      actorId: user.id,
      actorRole: user.roles[0],
      action,
      resource: `document:${documentId}`,
      caseId: doc.caseId,
      documentId,
      result: "DENIED",
      reason: authz.reason,
      requestId,
    });
    throw ApiError.forbidden("DOCUMENT_ACCESS_DENIED", authz.reason);
  }
  const version = doc.versions[0];
  if (!version) throw ApiError.notFound("Document version");
  return { doc, version };
}

/** API view of a DocumentIntelligence row. Only masked text is ever exposed, and only as a preview. */
export function toIntelligenceDto(row: DocumentIntelligence & { jobs?: { id: string; status: string; attempt: number; createdAt: Date; completedAt: Date | null; error: string | null }[] }) {
  return {
    id: row.id,
    documentId: row.documentId,
    versionId: row.versionId,
    disclaimer: AI_OUTPUT_DISCLAIMER,
    processing: {
      status: row.processingStatus,
      error: row.processingError,
      attempts: row.attempts,
      queuedAt: row.queuedAt,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
    },
    extraction: {
      status: row.extractionStatus,
      textSource: row.textSource,
      provider: row.extractionProvider,
      confidence: row.extractionConfidence,
      language: row.language,
      pageCount: row.pageCount,
      characterCount: row.characterCount,
      limitations: (row.extractionLimitations as string[] | null) ?? [],
      error: row.extractionError,
      textPreview: row.maskedText ? row.maskedText.slice(0, TEXT_PREVIEW_CHARS) : null,
      textTruncated: !!row.maskedText && row.maskedText.length > TEXT_PREVIEW_CHARS,
      masked: true,
    },
    pii: { status: row.piiStatus, findingCount: row.piiFindingCount, typeCounts: (row.piiTypeCounts as Record<string, number> | null) ?? {} },
    classification: {
      status: row.classificationStatus,
      reason: row.classificationReason,
      suggestedType: row.suggestedType,
      confidence: row.classificationConfidence,
      provider: row.classificationProvider,
      review: row.classificationReview,
      provenance: row.classificationProvenance,
      confirmedType: row.confirmedType,
      reviewedBy: row.classificationReviewedBy,
      reviewedAt: row.classificationReviewedAt,
    },
    metadata: {
      status: row.metadataStatus,
      reason: row.metadataReason,
      extracted: row.extractedMetadata as unknown as StructuredDocumentMetadata | null,
      provider: row.metadataProvider,
      review: row.metadataReview,
      provenance: row.metadataProvenance,
      confirmed: row.confirmedMetadata as unknown as Partial<StructuredDocumentMetadata> | null,
      reviewedBy: row.metadataReviewedBy,
      reviewedAt: row.metadataReviewedAt,
    },
    summary: {
      status: row.summaryStatus,
      reason: row.summaryReason,
      text: row.summary,
      provider: row.summaryProvider,
      generatedAt: row.summaryGeneratedAt,
      provenance: row.summary ? "AI_GENERATED" : null,
    },
    index: { status: row.indexStatus, indexedAt: row.indexedAt },
    jobs: (row.jobs ?? []).map((j) => ({ id: j.id, status: j.status, attempt: j.attempt, createdAt: j.createdAt, completedAt: j.completedAt, error: j.error })),
  };
}

export const IntelligenceService = {
  /**
   * Creates the QUEUED intelligence row + job for a new version, inside the
   * caller's upload/version transaction. Call enqueue() AFTER the transaction
   * commits so the worker can never observe uncommitted rows.
   */
  async createQueuedRecords(
    tx: Tx,
    input: { documentId: string; versionId: string; caseId: string; requestedById: string; requestId: string; actorRole?: string },
  ) {
    const intel = await tx.documentIntelligence.create({
      data: { documentId: input.documentId, versionId: input.versionId, caseId: input.caseId, requestedById: input.requestedById },
    });
    const job = await tx.aiProcessingJob.create({
      data: {
        documentId: input.documentId,
        versionId: input.versionId,
        intelligenceId: intel.id,
        jobType: "PROCESS_DOCUMENT",
        status: "QUEUED",
        requestedBy: input.requestedById,
      },
    });
    await AuditService.record(
      {
        actorId: input.requestedById,
        actorRole: input.actorRole,
        action: "AI_PROCESSING_QUEUED",
        resource: `document:${input.documentId}`,
        caseId: input.caseId,
        documentId: input.documentId,
        result: "SUCCESS",
        requestId: input.requestId,
        metadata: { jobId: job.id, attempt: 1 },
      },
      tx,
    );
    return { intelligenceId: intel.id, jobId: job.id, requestId: input.requestId };
  },

  enqueue(message: { intelligenceId: string; jobId: string; requestId: string }) {
    getProcessingQueue().enqueue(message);
  },

  /** Re-enqueues jobs left QUEUED by a restart (in-process queue is not durable). */
  async resumePendingJobs() {
    const pending = await prisma.aiProcessingJob.findMany({
      where: { jobType: "PROCESS_DOCUMENT", status: { in: ["QUEUED", "PROCESSING"] }, intelligenceId: { not: null } },
      orderBy: { createdAt: "asc" },
      take: 500,
    });
    for (const job of pending) this.enqueue({ intelligenceId: job.intelligenceId!, jobId: job.id, requestId: `resume-${job.id}` });
    return pending.length;
  },

  async get(user: AuthenticatedUser, documentId: string, requestId: string) {
    const { doc, version } = await loadAuthorizedDocument(user, documentId, PERMISSIONS.DOCUMENT_VIEW, requestId, "DOCUMENT_INTELLIGENCE_VIEWED");
    const row = await prisma.documentIntelligence.findUnique({
      where: { versionId: version.id },
      include: { jobs: { orderBy: { createdAt: "desc" }, take: 10 } },
    });
    const [canProcess, canApplyType] = await Promise.all([
      can(user, PERMISSIONS.AI_PROCESS, { case: doc.case, document: doc }),
      can(user, PERMISSIONS.DOCUMENT_VERSION, { case: doc.case, document: doc }),
    ]);
    return {
      document: { id: doc.id, title: doc.title, type: doc.type, confidentiality: doc.confidentiality, versionNumber: version.versionNumber },
      intelligence: row ? toIntelligenceDto(row) : null,
      policy: {
        restricted: doc.confidentiality === "RESTRICTED",
        restrictedReason: doc.confidentiality === "RESTRICTED" ? RESTRICTED_POLICY_REASON : null,
        aiProvider: getAIProvider().name,
        ocrProvider: getOCRProvider().providerName(),
      },
      capabilities: { canReprocess: canProcess.allowed, canReview: canProcess.allowed, canApplyType: canApplyType.allowed && canProcess.allowed },
    };
  },

  async reprocess(user: AuthenticatedUser, documentId: string, requestId: string) {
    const { doc, version } = await loadAuthorizedDocument(user, documentId, PERMISSIONS.AI_PROCESS, requestId, "AI_PROCESSING_QUEUED");
    const existing = await prisma.documentIntelligence.findUnique({ where: { versionId: version.id } });
    if (existing && ACTIVE_STATES.has(existing.processingStatus)) {
      throw ApiError.conflict("PROCESSING_IN_PROGRESS", "This document version is already queued or being processed.");
    }

    const message = await prisma.$transaction(async (tx) => {
      // Human review decisions survive reprocessing; AI suggestions are regenerated.
      const intel = existing
        ? await tx.documentIntelligence.update({
            where: { id: existing.id },
            data: {
              processingStatus: "QUEUED",
              processingError: null,
              queuedAt: new Date(),
              startedAt: null,
              completedAt: null,
              requestedById: user.id,
              extractionStatus: "QUEUED",
              classificationStatus: "PENDING",
              metadataStatus: "PENDING",
              summaryStatus: "PENDING",
              piiStatus: "PENDING",
              indexStatus: "PENDING",
            },
          })
        : await tx.documentIntelligence.create({ data: { documentId: doc.id, versionId: version.id, caseId: doc.caseId, requestedById: user.id } });
      const attempt = (existing?.attempts ?? 0) + 1;
      const job = await tx.aiProcessingJob.create({
        data: { documentId: doc.id, versionId: version.id, intelligenceId: intel.id, jobType: "PROCESS_DOCUMENT", status: "QUEUED", requestedBy: user.id, attempt },
      });
      await AuditService.record(
        {
          actorId: user.id,
          actorRole: user.roles[0],
          action: "AI_PROCESSING_QUEUED",
          resource: `document:${doc.id}`,
          caseId: doc.caseId,
          documentId: doc.id,
          result: "SUCCESS",
          requestId,
          metadata: { jobId: job.id, attempt, reprocess: true, versionNumber: version.versionNumber },
        },
        tx,
      );
      return { intelligenceId: intel.id, jobId: job.id, requestId };
    });
    this.enqueue(message);
    return { jobId: message.jobId, intelligenceId: message.intelligenceId, status: "QUEUED" as const };
  },

  async regenerateSummary(user: AuthenticatedUser, documentId: string, requestId: string) {
    const { doc, version } = await loadAuthorizedDocument(user, documentId, PERMISSIONS.AI_PROCESS, requestId, "DOCUMENT_SUMMARY_GENERATED");
    if (doc.confidentiality === "RESTRICTED") throw ApiError.forbidden("AI_POLICY_BLOCKED", RESTRICTED_POLICY_REASON);
    const row = await prisma.documentIntelligence.findUnique({ where: { versionId: version.id } });
    if (!row || !row.maskedText) throw ApiError.badRequest("NO_EXTRACTED_TEXT", "No extracted text is available to summarize. Process the document first.");
    if (ACTIVE_STATES.has(row.processingStatus)) throw ApiError.conflict("PROCESSING_IN_PROGRESS", "This document version is still being processed.");

    const audit = (action: string, extra: { result?: "SUCCESS" | "DENIED" | "ERROR"; reason?: string; metadata?: Record<string, AuditMetadataValue | undefined> } = {}) =>
      AuditService.record({
        actorId: user.id,
        actorRole: user.roles[0],
        action,
        resource: `document:${doc.id}`,
        caseId: doc.caseId,
        documentId: doc.id,
        requestId,
        ...extra,
        metadata: { versionNumber: version.versionNumber, ...extra.metadata },
      });
    try {
      const updated = await generateSummary(row.id, row.maskedText, audit, true);
      return toIntelligenceDto(updated);
    } catch {
      await audit("DOCUMENT_SUMMARY_GENERATED", { result: "ERROR", reason: "The AI provider failed to generate a summary." });
      throw new ApiError(502, "AI_PROVIDER_ERROR", "The AI provider failed to generate a summary. Try again later.");
    }
  },

  async reviewClassification(
    user: AuthenticatedUser,
    documentId: string,
    input: { decision: "CONFIRM" | "CORRECT" | "REJECT"; type?: string; applyToDocument?: boolean; note?: string },
    requestId: string,
  ) {
    const { doc, version } = await loadAuthorizedDocument(user, documentId, PERMISSIONS.AI_PROCESS, requestId, "AI_CLASSIFICATION_REVIEWED");
    const row = await prisma.documentIntelligence.findUnique({ where: { versionId: version.id } });
    if (!row || row.classificationStatus !== "COMPLETED" || !row.suggestedType) {
      throw ApiError.badRequest("NO_SUGGESTION", "There is no AI classification suggestion to review for this version.");
    }

    let confirmedType: string | null = null;
    if (input.decision === "CONFIRM") confirmedType = row.suggestedType;
    if (input.decision === "CORRECT") {
      if (!input.type || !(DOCUMENT_CLASSIFICATION_TYPES as readonly string[]).includes(input.type)) {
        throw ApiError.badRequest("INVALID_TYPE", "A valid document type is required to correct the classification.");
      }
      confirmedType = input.type;
    }

    let appliedToDocument = false;
    if (input.applyToDocument && confirmedType) {
      const authz = await can(user, PERMISSIONS.DOCUMENT_VERSION, { case: doc.case, document: doc });
      if (!authz.allowed) throw ApiError.forbidden("DOCUMENT_ACCESS_DENIED", "Updating the document's recorded type requires document.version.");
      if (!DocumentTypeEnum.safeParse(confirmedType).success) {
        throw ApiError.badRequest("TYPE_NOT_APPLICABLE", `"${confirmedType}" cannot be recorded as the document's type.`);
      }
      appliedToDocument = true;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const r = await tx.documentIntelligence.update({
        where: { id: row.id },
        data: {
          classificationReview: input.decision === "REJECT" ? "REJECTED" : "CONFIRMED",
          classificationProvenance: input.decision === "CONFIRM" ? "HUMAN_CONFIRMED" : input.decision === "CORRECT" ? "AI_ASSISTED" : "AI_GENERATED",
          confirmedType,
          classificationReviewedBy: user.id,
          classificationReviewedAt: new Date(),
        },
      });
      if (appliedToDocument) await tx.document.update({ where: { id: doc.id }, data: { type: confirmedType! } });
      await AuditService.record(
        {
          actorId: user.id,
          actorRole: user.roles[0],
          action: "AI_CLASSIFICATION_REVIEWED",
          resource: `document:${doc.id}`,
          caseId: doc.caseId,
          documentId: doc.id,
          result: "SUCCESS",
          requestId,
          reason: input.note,
          metadata: {
            decision: input.decision,
            suggestedType: row.suggestedType,
            confirmedType,
            appliedToDocument,
            previousDocumentType: appliedToDocument ? doc.type : undefined,
            versionNumber: version.versionNumber,
          },
        },
        tx,
      );
      return r;
    });
    return toIntelligenceDto(updated);
  },

  async reviewMetadata(
    user: AuthenticatedUser,
    documentId: string,
    input: { decision: "CONFIRM" | "CORRECT" | "REJECT"; metadata?: Record<string, unknown>; note?: string },
    requestId: string,
  ) {
    const { doc, version } = await loadAuthorizedDocument(user, documentId, PERMISSIONS.AI_PROCESS, requestId, "AI_METADATA_REVIEWED");
    const row = await prisma.documentIntelligence.findUnique({ where: { versionId: version.id } });
    if (!row || row.metadataStatus !== "COMPLETED" || !row.extractedMetadata) {
      throw ApiError.badRequest("NO_SUGGESTION", "There is no extracted metadata to review for this version.");
    }
    const extracted = row.extractedMetadata as unknown as StructuredDocumentMetadata;

    let confirmed: Partial<StructuredDocumentMetadata> | null = null;
    const changedFields: string[] = [];
    if (input.decision === "CONFIRM") confirmed = extracted;
    if (input.decision === "CORRECT") {
      if (!input.metadata) throw ApiError.badRequest("INVALID_METADATA", "Corrected metadata is required.");
      confirmed = { ...extracted };
      for (const [key, value] of Object.entries(input.metadata)) {
        if (!(key in extracted)) continue;
        // Human-entered values are authoritative: confidence 1, or 0 when cleared.
        (confirmed as Record<string, unknown>)[key] = { value: value ?? null, confidence: value === null || value === undefined ? 0 : 1 };
        changedFields.push(key);
      }
    }

    // Rejected metadata stops contributing to search; confirmed/corrected values replace it.
    const metadataText =
      input.decision === "REJECT"
        ? row.confirmedType ?? row.suggestedType ?? null
        : [metadataToSearchText(confirmed), row.confirmedType ?? row.suggestedType ?? ""].join(" ").trim() || null;

    const updated = await prisma.$transaction(async (tx) => {
      const r = await tx.documentIntelligence.update({
        where: { id: row.id },
        data: {
          metadataReview: input.decision === "REJECT" ? "REJECTED" : "CONFIRMED",
          metadataProvenance: input.decision === "CONFIRM" ? "HUMAN_CONFIRMED" : input.decision === "CORRECT" ? "AI_ASSISTED" : "AI_GENERATED",
          confirmedMetadata: confirmed ? (confirmed as unknown as Prisma.InputJsonObject) : Prisma.DbNull,
          metadataReviewedBy: user.id,
          metadataReviewedAt: new Date(),
          metadataText,
        },
      });
      await AuditService.record(
        {
          actorId: user.id,
          actorRole: user.roles[0],
          action: "AI_METADATA_REVIEWED",
          resource: `document:${doc.id}`,
          caseId: doc.caseId,
          documentId: doc.id,
          result: "SUCCESS",
          requestId,
          reason: input.note,
          // Field names only — corrected values may contain personal data.
          metadata: { decision: input.decision, changedFields, versionNumber: version.versionNumber },
        },
        tx,
      );
      return r;
    });
    return toIntelligenceDto(updated);
  },
};

