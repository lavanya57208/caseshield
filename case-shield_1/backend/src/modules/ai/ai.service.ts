import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/errors";
import { AuthenticatedUser } from "@/middleware/auth";
import { can } from "@/lib/authorization";
import { PERMISSIONS } from "@/lib/permissions";
import { getAIProvider } from "@/modules/ai/index";
import { getStorageProvider } from "@/modules/storage";
import { AuditService } from "@/modules/audit/audit.service";

// AI must never bypass authorization, and its output must always be
// attributable/correctable — see docs/security-architecture.md §11 and
// docs/architecture.md §8. Every method here performs, in order:
//   1. authorization check (same permission model as everything else)
//   2. confidentiality/classification policy check
//   3. audit log of the AI operation
// before the provider is ever called.
async function authorizeAndPrepare(user: AuthenticatedUser, documentId: string, requestId: string) {
  const doc = await prisma.document.findFirst({
    where: { id: documentId, deletedAt: null },
    include: { case: true, versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
  });
  if (!doc) throw ApiError.notFound("Document");

  const authz = await can(user, PERMISSIONS.AI_PROCESS, { case: doc.case, document: doc });
  if (!authz.allowed) {
    await AuditService.record({
      actorId: user.id,
      actorRole: user.roles[0],
      action: "AI_PROCESSING_DENIED",
      resource: `document:${documentId}`,
      caseId: doc.caseId,
      documentId,
      result: "DENIED",
      reason: authz.reason,
      requestId,
    });
    throw ApiError.forbidden("AI_ACCESS_DENIED", authz.reason);
  }

  // Policy: RESTRICTED material is never sent to the AI provider, even for
  // an otherwise-authorized user, in this prototype's default policy.
  if (doc.confidentiality === "RESTRICTED") {
    throw ApiError.forbidden(
      "AI_POLICY_BLOCKED",
      "This document's classification (RESTRICTED) excludes it from AI processing by policy.",
    );
  }

  await AuditService.record({
    actorId: user.id,
    actorRole: user.roles[0],
    action: "AI_PROCESSING",
    resource: `document:${documentId}`,
    caseId: doc.caseId,
    documentId,
    result: "SUCCESS",
    requestId,
  });

  const version = doc.versions[0];
  let textSample = "";
  if (version && ["text/plain"].includes(version.mimeType)) {
    try {
      const buf = await getStorageProvider().get(version.storageKey);
      textSample = buf.toString("utf-8").slice(0, 4000);
    } catch {
      textSample = "";
    }
  }

  return { doc, version, textSample: textSample || doc.title };
}

export const AiService = {
  async extractMetadata(user: AuthenticatedUser, documentId: string, requestId: string) {
    const { doc, version, textSample } = await authorizeAndPrepare(user, documentId, requestId);
    const result = await getAIProvider().extractMetadata({
      fileName: version?.fileName ?? doc.title,
      mimeType: version?.mimeType ?? "application/octet-stream",
      textSample,
    });
    return prisma.aiProcessingJob.create({
      data: {
        documentId,
        jobType: "EXTRACT_METADATA",
        status: "COMPLETED",
        result: result as any,
        requestedBy: user.id,
        completedAt: new Date(),
      },
    });
  },

  async classify(user: AuthenticatedUser, documentId: string, requestId: string) {
    const { doc, version, textSample } = await authorizeAndPrepare(user, documentId, requestId);
    const result = await getAIProvider().classifyDocument({ fileName: version?.fileName ?? doc.title, textSample });
    return prisma.aiProcessingJob.create({
      data: { documentId, jobType: "CLASSIFY", status: "COMPLETED", result: result as any, requestedBy: user.id, completedAt: new Date() },
    });
  },

  async summarize(user: AuthenticatedUser, documentId: string, requestId: string) {
    const { textSample } = await authorizeAndPrepare(user, documentId, requestId);
    const result = await getAIProvider().summarizeDocument({ textSample });
    return prisma.aiProcessingJob.create({
      data: { documentId, jobType: "SUMMARIZE", status: "COMPLETED", result: result as any, requestedBy: user.id, completedAt: new Date() },
    });
  },

  async jobStatus(user: AuthenticatedUser, jobId: string) {
    const job = await prisma.aiProcessingJob.findUnique({ where: { id: jobId }, include: { document: { include: { case: true } } } });
    if (!job) throw ApiError.notFound("AI job");
    const authz = await can(user, PERMISSIONS.DOCUMENT_VIEW, { case: job.document.case, document: job.document });
    if (!authz.allowed) throw ApiError.forbidden("AI_ACCESS_DENIED", authz.reason);
    return job;
  },
};
