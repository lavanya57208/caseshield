import { Prisma, TextExtractionStatus, TextSource, IntelligenceStepStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sha256 } from "@/lib/hash";
import { AuditService, AuditMetadataValue } from "@/modules/audit/audit.service";
import { SecurityService } from "@/modules/security/security.service";
import { getStorageProvider } from "@/modules/storage";
import { extractText } from "@/modules/privacy/extraction/text-extraction";
import { getPiiDetectionProvider } from "@/modules/privacy/pii";
import { maskPiiInText } from "@/modules/privacy/pii/deterministic-pii.provider";
import { getAIProvider } from "@/modules/ai/index";
import { getOCRProvider, OCR_CANDIDATE_MIME_TYPES } from "@/modules/ai/ocr";
import { DOCUMENT_CLASSIFICATION_TYPES, StructuredDocumentMetadata } from "@/modules/ai/ai-provider.types";
import { metadataToSearchText } from "@/modules/ai/heuristics";
import { applySummaryGuardrails } from "@/modules/ai/guardrails";
import { ProcessingJobMessage } from "@/modules/ai/processing/processing-queue";

// The document-processing pipeline — see docs/document-processing.md.
//
//   verify SHA-256 → text layer / OCR → PII detection + masking →
//   classification → metadata → summary → search index
//
// Invariants:
//  - The original stored object is only READ, and only after its bytes match
//    the registered SHA-256. All outputs are derived rows.
//  - Only PII-MASKED text is stored, indexed, or sent to an AI provider.
//  - RESTRICTED documents never reach OCR or AI providers (policy); their
//    text layer is still indexed for authorized keyword search.
//  - Each step fails independently and is recorded as FAILED with a safe,
//    content-free reason; nothing here logs document text or PII.

export const MAX_STORED_TEXT_CHARS = 200_000;
export const MAX_AI_INPUT_CHARS = 30_000;
export const RESTRICTED_POLICY_REASON = "RESTRICTED documents are excluded from OCR and AI processing by policy.";
const TEXT_LAYER_PROVIDER = "Built-in text-layer extractor (pdf.js / UTF-8)";

class PipelineAbort extends Error {}

const safeMessage = (err: unknown) => (err instanceof Error ? err.message : "Unknown error").replace(/\s+/g, " ").slice(0, 300);

async function actorFor(userId: string | null) {
  if (!userId) return { actorId: null, actorRole: null };
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { userRoles: { select: { role: { select: { key: true } } } } } });
  return { actorId: userId, actorRole: user?.userRoles[0]?.role.key ?? null };
}

interface ExtractionOutcome {
  status: TextExtractionStatus;
  source: TextSource;
  provider: string | null;
  confidence: number | null;
  language: string | null;
  pages: { pageNumber: number; text: string }[];
  limitations: string[];
  error: string | null;
}

export async function runDocumentPipeline(message: ProcessingJobMessage): Promise<void> {
  const intel = await prisma.documentIntelligence.findUnique({
    where: { id: message.intelligenceId },
    include: { version: true, document: { include: { case: true } } },
  });
  if (!intel || intel.document.deletedAt) return;
  const { version, document: doc } = intel;
  const actor = await actorFor(intel.requestedById);
  const audit = (action: string, extra: { result?: "SUCCESS" | "DENIED" | "ERROR"; reason?: string; metadata?: Record<string, AuditMetadataValue | undefined> } = {}) =>
    AuditService.record({
      ...actor,
      action,
      resource: `document:${doc.id}`,
      caseId: doc.caseId,
      documentId: doc.id,
      requestId: message.requestId,
      ...extra,
      metadata: { versionNumber: version.versionNumber, jobId: message.jobId, ...extra.metadata },
    });
  const update = (data: Prisma.DocumentIntelligenceUpdateInput) => prisma.documentIntelligence.update({ where: { id: intel.id }, data });

  const startedAt = new Date();
  await update({ processingStatus: "PROCESSING", startedAt, completedAt: null, processingError: null, attempts: { increment: 1 }, extractionStatus: "PROCESSING" });
  await prisma.aiProcessingJob.update({ where: { id: message.jobId }, data: { status: "PROCESSING", startedAt } });
  await audit("AI_PROCESSING_STARTED");

  let extractionRecorded = false;
  try {
    // 1. Integrity: never derive anything from bytes that no longer match.
    const buffer = await getStorageProvider().get(version.storageKey);
    if (sha256(buffer) !== version.sha256Hash) {
      await audit("INTEGRITY_VIOLATION", { result: "ERROR", reason: "Source hash mismatch; document processing refused." });
      await SecurityService.record({
        type: "INTEGRITY_VIOLATION",
        userId: intel.requestedById ?? undefined,
        caseId: doc.caseId,
        documentId: doc.id,
        severity: "CRITICAL",
        detail: `Hash mismatch on ${doc.documentNumber} v${version.versionNumber} during document processing.`,
      });
      throw new PipelineAbort("Source integrity verification failed; processing was refused.");
    }

    const restricted = doc.confidentiality === "RESTRICTED";

    // 2. Text extraction / OCR
    const extraction = await extractOrOcr(buffer, version.mimeType, version.fileName, restricted, audit);
    const rawPages = extraction.pages.filter((p) => p.text.trim().length > 0);
    const hasText = rawPages.length > 0;

    // 3. PII detection → masked text (the only text that is stored or sent on)
    let piiStatus: IntelligenceStepStatus = "SKIPPED";
    let piiFindingCount: number | null = null;
    let piiTypeCounts: Record<string, number> | null = null;
    let maskedText: string | null = null;
    if (hasText) {
      const detections = await getPiiDetectionProvider().detect(rawPages);
      piiTypeCounts = {};
      for (const d of detections) piiTypeCounts[d.type] = (piiTypeCounts[d.type] ?? 0) + 1;
      piiFindingCount = detections.length;
      piiStatus = "COMPLETED";
      maskedText = rawPages.map((p) => maskPiiInText(p.text)).join("\n\n").slice(0, MAX_STORED_TEXT_CHARS);
    }
    const characterCount = rawPages.reduce((n, p) => n + p.text.length, 0);

    await update({
      extractionStatus: extraction.status,
      textSource: extraction.source,
      extractionProvider: extraction.provider,
      extractionConfidence: extraction.confidence,
      language: extraction.language,
      pageCount: extraction.pages.length || null,
      characterCount: hasText ? characterCount : null,
      extractionLimitations: extraction.limitations,
      extractionError: extraction.error,
      maskedText,
      piiStatus,
      piiFindingCount,
      piiTypeCounts: piiTypeCounts ?? Prisma.DbNull,
    });
    extractionRecorded = true;

    // 4–6. AI steps (on masked text only), each independently fallible.
    const ai = await runAiSteps(intel.id, { fileName: version.fileName, mimeType: version.mimeType, maskedText, restricted }, audit);

    // 7. Search index — the trigger rebuilds searchVector from metadataText + maskedText.
    const indexable = !!maskedText || !!ai.metadataText;
    const failedSteps = [extraction.status === "FAILED" || extraction.status === "PARTIAL", ...ai.failed].filter(Boolean).length;
    const processingStatus = failedSteps > 0 ? "PARTIAL" : "COMPLETED";
    const completedAt = new Date();
    await update({
      indexStatus: indexable ? "COMPLETED" : "SKIPPED",
      indexedAt: indexable ? completedAt : null,
      processingStatus,
      completedAt,
    });
    await prisma.aiProcessingJob.update({
      where: { id: message.jobId },
      data: {
        status: processingStatus,
        completedAt,
        provider: getAIProvider().name,
        result: { extractionStatus: extraction.status, textSource: extraction.source, piiFindingCount, ...ai.statuses } as Prisma.InputJsonObject,
      },
    });
    await audit("AI_PROCESSING_COMPLETED", {
      result: "SUCCESS",
      metadata: { status: processingStatus, extractionStatus: extraction.status, textSource: extraction.source, piiFindingCount, ...ai.statuses },
    });
  } catch (err) {
    const reason = err instanceof PipelineAbort ? err.message : `Processing failed: ${safeMessage(err)}`;
    const completedAt = new Date();
    await update({ processingStatus: "FAILED", processingError: reason, completedAt, extractionStatus: extractionRecorded ? undefined : "FAILED" });
    await prisma.aiProcessingJob.update({ where: { id: message.jobId }, data: { status: "FAILED", error: reason, completedAt } });
    await audit("AI_PROCESSING_FAILED", { result: "ERROR", reason });
  }
}

async function extractOrOcr(
  buffer: Buffer,
  mimeType: string,
  fileName: string,
  restricted: boolean,
  audit: (action: string, extra?: any) => Promise<unknown>,
): Promise<ExtractionOutcome> {
  const base = { provider: null, confidence: null, language: null, pages: [], limitations: [] as string[], error: null };
  const layer = await extractText(buffer, mimeType);

  if (layer.supported && layer.textLayer) {
    return {
      ...base,
      status: "TEXT_EXTRACTED",
      source: "TEXT_LAYER",
      provider: TEXT_LAYER_PROVIDER,
      pages: layer.pages.map((p) => ({ pageNumber: p.pageNumber, text: p.text })),
      // pdf.js reports embedded images; their text is not OCR-processed on this path.
      limitations: layer.limitations.map((l) => (/OCR not implemented/i.test(l) ? "The PDF contains images; text inside embedded images was not OCR-processed." : l)),
    };
  }

  const scannedPdf = mimeType === "application/pdf" && layer.supported && !layer.textLayer;
  const ocrCandidate = scannedPdf || (OCR_CANDIDATE_MIME_TYPES.has(mimeType) && mimeType !== "application/pdf");
  if (!ocrCandidate) {
    if (mimeType === "application/pdf") return { ...base, status: "FAILED", source: "NONE", error: layer.unsupportedReason ?? "The PDF could not be read." };
    if (layer.supported) return { ...base, status: "FAILED", source: "NONE", error: "The file contains no extractable text." };
    return { ...base, status: "UNSUPPORTED", source: "NONE", error: `Text extraction and OCR are not available for ${mimeType}.` };
  }

  if (restricted) return { ...base, status: "SKIPPED", source: "NONE", error: RESTRICTED_POLICY_REASON };

  const ocr = getOCRProvider();
  if (!ocr.supportsMimeType(mimeType)) {
    return { ...base, status: "UNSUPPORTED", source: "NONE", provider: ocr.providerName(), error: `The configured OCR provider does not support ${mimeType}.` };
  }
  await audit("OCR_STARTED", { metadata: { provider: ocr.providerName() } });
  try {
    const result = await ocr.extractText({ buffer, mimeType, fileName });
    const status: TextExtractionStatus =
      result.status === "COMPLETED" ? "OCR_PROCESSED" : result.status === "PARTIAL" ? "PARTIAL" : result.status === "UNSUPPORTED" ? "UNSUPPORTED" : "FAILED";
    const ok = status === "OCR_PROCESSED" || status === "PARTIAL";
    await audit(ok ? "OCR_COMPLETED" : "OCR_FAILED", {
      result: ok ? "SUCCESS" : "ERROR",
      reason: ok ? undefined : result.error,
      metadata: { provider: ocr.providerName(), status, pageCount: result.pages.length, confidence: result.confidence ?? null },
    });
    return {
      status,
      source: ok ? "OCR" : "NONE",
      provider: ocr.providerName(),
      confidence: result.confidence ?? null,
      language: result.language ?? null,
      pages: ok ? result.pages : [],
      limitations: result.limitations,
      error: result.error ?? null,
    };
  } catch (err) {
    const reason = `OCR provider error: ${safeMessage(err)}`;
    await audit("OCR_FAILED", { result: "ERROR", reason, metadata: { provider: ocr.providerName() } });
    return { ...base, status: "FAILED", source: "NONE", provider: ocr.providerName(), error: reason };
  }
}

type AiStepKey = "classification" | "metadata" | "summary";

async function runAiSteps(
  intelligenceId: string,
  input: { fileName: string; mimeType: string; maskedText: string | null; restricted: boolean },
  audit: (action: string, extra?: any) => Promise<unknown>,
): Promise<{ failed: boolean[]; statuses: Record<string, string>; metadataText: string | null }> {
  const skipReason = input.restricted ? RESTRICTED_POLICY_REASON : !input.maskedText ? "No extracted text is available for AI processing." : null;
  const existing = await prisma.documentIntelligence.findUniqueOrThrow({ where: { id: intelligenceId } });
  const statuses: Record<string, string> = {};
  const failed: boolean[] = [];

  if (skipReason) {
    await prisma.documentIntelligence.update({
      where: { id: intelligenceId },
      data: {
        classificationStatus: "SKIPPED",
        classificationReason: skipReason,
        metadataStatus: "SKIPPED",
        metadataReason: skipReason,
        summaryStatus: "SKIPPED",
        summaryReason: skipReason,
        metadataText: null,
      },
    });
    for (const k of ["classification", "metadata", "summary"] as AiStepKey[]) statuses[`${k}Status`] = "SKIPPED";
    return { failed, statuses, metadataText: null };
  }

  const provider = getAIProvider();
  const text = input.maskedText!.slice(0, MAX_AI_INPUT_CHARS);

  // Classification — a suggestion only; never written to Document.type here.
  let suggestedType: string | null = null;
  let typeConfidence = 0;
  try {
    const result = await provider.classifyDocument({ fileName: input.fileName, textSample: text });
    suggestedType = (DOCUMENT_CLASSIFICATION_TYPES as readonly string[]).includes(result.suggestedType) ? result.suggestedType : "OTHER";
    typeConfidence = Math.max(0, Math.min(1, result.confidence));
    await prisma.documentIntelligence.update({
      where: { id: intelligenceId },
      data: {
        classificationStatus: "COMPLETED",
        classificationReason: result.rationale?.slice(0, 300) ?? null,
        suggestedType,
        classificationConfidence: typeConfidence,
        classificationProvider: provider.name,
        ...(existing.classificationReview === "PENDING_REVIEW" ? { classificationProvenance: "AI_GENERATED" } : {}),
      },
    });
    statuses.classificationStatus = "COMPLETED";
    await audit("DOCUMENT_CLASSIFIED", { result: "SUCCESS", metadata: { suggestedType, confidence: typeConfidence, provider: provider.name } });
  } catch (err) {
    failed.push(true);
    statuses.classificationStatus = "FAILED";
    await prisma.documentIntelligence.update({ where: { id: intelligenceId }, data: { classificationStatus: "FAILED", classificationReason: `AI provider error: ${safeMessage(err)}` } });
  }

  // Metadata — unknown values stay null; stored as AI_GENERATED suggestions.
  let metadataText: string | null = null;
  try {
    const result = await provider.extractMetadata({ fileName: input.fileName, mimeType: input.mimeType, textSample: text });
    const fields = result.fields ?? null;
    const confirmed = existing.metadataReview === "CONFIRMED" ? (existing.confirmedMetadata as Partial<StructuredDocumentMetadata> | null) : null;
    const indexedType = existing.classificationReview === "CONFIRMED" ? existing.confirmedType : suggestedType;
    metadataText = [metadataToSearchText(confirmed ?? fields), indexedType ?? ""].join(" ").trim() || null;
    await prisma.documentIntelligence.update({
      where: { id: intelligenceId },
      data: {
        metadataStatus: "COMPLETED",
        metadataReason: null,
        extractedMetadata: (fields as unknown as Prisma.InputJsonObject) ?? Prisma.DbNull,
        metadataProvider: provider.name,
        metadataText,
        ...(existing.metadataReview === "PENDING_REVIEW" ? { metadataProvenance: "AI_GENERATED" } : {}),
      },
    });
    statuses.metadataStatus = "COMPLETED";
    const fieldsFound = fields ? Object.values(fields).filter((f) => f && f.value !== null).length : 0;
    await audit("DOCUMENT_METADATA_EXTRACTED", { result: "SUCCESS", metadata: { fieldsFound, provider: provider.name } });
  } catch (err) {
    failed.push(true);
    statuses.metadataStatus = "FAILED";
    await prisma.documentIntelligence.update({ where: { id: intelligenceId }, data: { metadataStatus: "FAILED", metadataReason: `AI provider error: ${safeMessage(err)}` } });
  }

  // Summary
  try {
    await generateSummary(intelligenceId, input.maskedText!, audit, false);
    statuses.summaryStatus = "COMPLETED";
  } catch {
    failed.push(true);
    statuses.summaryStatus = "FAILED";
  }

  return { failed, statuses, metadataText };
}

/** Generates (or regenerates) the AI summary from stored masked text. Throws after recording a FAILED step. */
export async function generateSummary(
  intelligenceId: string,
  maskedText: string,
  audit: (action: string, extra?: any) => Promise<unknown>,
  regenerated: boolean,
) {
  const provider = getAIProvider();
  try {
    const raw = await provider.summarizeDocument({ textSample: maskedText.slice(0, MAX_AI_INPUT_CHARS) });
    const guarded = applySummaryGuardrails(raw.summary, maskedText);
    // Defence in depth: the input was masked, but mask the output again.
    const summary = maskPiiInText(guarded.summary) || "The AI provider did not produce a usable summary for this document.";
    const updated = await prisma.documentIntelligence.update({
      where: { id: intelligenceId },
      data: { summaryStatus: "COMPLETED", summaryReason: null, summary, summaryProvider: provider.name, summaryGeneratedAt: new Date() },
    });
    await audit("DOCUMENT_SUMMARY_GENERATED", { result: "SUCCESS", metadata: { provider: provider.name, regenerated, guardrailRemovedSentences: guarded.removedSentences } });
    return updated;
  } catch (err) {
    await prisma.documentIntelligence.update({ where: { id: intelligenceId }, data: { summaryStatus: "FAILED", summaryReason: `AI provider error: ${safeMessage(err)}` } });
    throw err;
  }
}
