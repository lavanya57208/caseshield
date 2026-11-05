import { v4 as uuidv4 } from "uuid";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sha256 } from "@/lib/hash";
import { ApiError } from "@/lib/errors";
import { can } from "@/lib/authorization";
import { PERMISSIONS, PermissionKey } from "@/lib/permissions";
import { AuthenticatedUser } from "@/middleware/auth";
import { AuditService, AuditMetadataValue } from "@/modules/audit/audit.service";
import { SecurityService } from "@/modules/security/security.service";
import { getStorageProvider, buildDerivativeStorageKey } from "@/modules/storage";
import { loadDocumentOrThrow } from "@/modules/documents/documents.service";
import { extractText, ExtractionResult } from "@/modules/privacy/extraction/text-extraction";
import { getPiiDetectionProvider, PiiDetection, PII_TYPE_LABELS, PiiType } from "@/modules/privacy/pii";
import { piiFingerprint } from "@/modules/privacy/pii/fingerprint";
import { getDocumentProcessor, UnsupportedProcessingError, WatermarkSpec, ProcessorOutput } from "@/modules/privacy/processing";
import { extractPdfPlainText } from "@/modules/privacy/processing/pdf.processor";
import { purposeLabel, SharePurposeKey } from "@/modules/sharing/share-purposes";

// PII scanning, redaction and watermarking of document DERIVATIVES.
//
// Invariants (see docs/security-architecture.md §PII Protection):
//  - The original DocumentVersion object is only ever READ. Every output is
//    written under a new derived/ storage key and a new DocumentDerivative row.
//  - Source bytes are integrity-checked against the registered SHA-256
//    before anything is derived from them.
//  - Raw PII values exist only in memory during a request. The database
//    stores type, confidence, location, masked preview and a keyed HMAC.
//  - Nothing here logs extracted text or detected values.

export type LoadedDocument = Awaited<ReturnType<typeof loadDocumentOrThrow>>;
type VersionRecord = LoadedDocument["versions"][number];

function actor(user: AuthenticatedUser) {
  return { actorId: user.id, actorRole: user.roles[0] ?? null };
}

async function authorize(
  user: AuthenticatedUser,
  permission: PermissionKey,
  doc: LoadedDocument,
  deniedAction: string,
  requestId: string,
) {
  const authz = await can(user, permission, { case: doc.case, document: doc });
  if (!authz.allowed) {
    await AuditService.record({
      ...actor(user),
      action: deniedAction,
      resource: `document:${doc.id}`,
      caseId: doc.caseId,
      documentId: doc.id,
      result: "DENIED",
      reason: authz.reason,
      metadata: { permission, organizationId: user.organizationId },
      requestId,
    });
    throw ApiError.forbidden("DOCUMENT_ACCESS_DENIED", authz.reason);
  }
}

function resolveVersion(doc: LoadedDocument, versionNumber?: number): VersionRecord {
  const version = versionNumber ? doc.versions.find((v) => v.versionNumber === versionNumber) : doc.versions[0];
  if (!version) throw ApiError.notFound("Document version");
  return version;
}

/** Reads a stored original and refuses to derive from it if its hash no longer matches. */
export async function readVerifiedVersion(user: AuthenticatedUser | null, doc: LoadedDocument, version: VersionRecord, requestId: string) {
  const buffer = await getStorageProvider().get(version.storageKey);
  if (sha256(buffer) !== version.sha256Hash) {
    await AuditService.record({
      actorId: user?.id ?? null,
      actorRole: user?.roles[0] ?? null,
      action: "INTEGRITY_VIOLATION",
      resource: `document:${doc.id}`,
      caseId: doc.caseId,
      documentId: doc.id,
      result: "ERROR",
      reason: "Source hash mismatch; derivative generation refused.",
      metadata: { versionNumber: version.versionNumber },
      requestId,
    });
    await SecurityService.record({
      type: "INTEGRITY_VIOLATION",
      userId: user?.id,
      caseId: doc.caseId,
      documentId: doc.id,
      severity: "CRITICAL",
      detail: `Hash mismatch on ${doc.documentNumber} v${version.versionNumber} while preparing a derivative.`,
    });
    throw ApiError.conflict(
      "INTEGRITY_VIOLATION",
      "This document version failed integrity verification. Derived copies cannot be produced from it.",
    );
  }
  return buffer;
}

export async function readVerifiedDerivative(derivative: { storageKey: string | null; sha256Hash: string | null; id: string }) {
  if (!derivative.storageKey || !derivative.sha256Hash) throw ApiError.conflict("DERIVATIVE_NOT_READY", "This derived copy is not available.");
  const buffer = await getStorageProvider().get(derivative.storageKey);
  if (sha256(buffer) !== derivative.sha256Hash) {
    throw ApiError.conflict("INTEGRITY_VIOLATION", "The derived copy failed integrity verification.");
  }
  return buffer;
}

function baseFileName(fileName: string) {
  const stem = fileName.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9._-]/g, "_");
  return stem || "document";
}

function countByType(types: PiiType[]) {
  const counts: Record<string, number> = {};
  for (const t of types) counts[t] = (counts[t] ?? 0) + 1;
  return counts;
}

function presentScan(scan: any, coverage?: Record<string, string>) {
  return {
    id: scan.id,
    documentId: scan.documentId,
    versionId: scan.versionId,
    versionNumber: scan.version?.versionNumber,
    status: scan.status,
    provider: scan.provider,
    textLayer: scan.textLayer,
    pageCount: scan.pageCount,
    findingCount: scan.findingCount,
    limitations: scan.limitations ?? [],
    statusReason: scan.statusReason,
    startedAt: scan.startedAt,
    completedAt: scan.completedAt,
    requestedBy: scan.requestedBy ? { fullName: scan.requestedBy.fullName } : undefined,
    coverage: coverage ?? getPiiDetectionProvider().coverage,
    // Deliberately no offsets/fingerprints/values — masked metadata only.
    findings: (scan.findings ?? []).map((f: any) => ({
      id: f.id,
      type: f.type,
      label: PII_TYPE_LABELS[f.type as PiiType],
      confidence: f.confidence,
      pageNumber: f.pageNumber,
      maskedPreview: f.maskedPreview,
      detectionMethod: f.detectionMethod,
    })),
  };
}

export function presentDerivative(d: any) {
  return {
    id: d.id,
    documentId: d.documentId,
    sourceVersionId: d.sourceVersionId,
    sourceVersionNumber: d.sourceVersion?.versionNumber,
    parentDerivativeId: d.parentDerivativeId,
    type: d.type,
    status: d.status,
    statusReason: d.statusReason,
    fileName: d.fileName,
    mimeType: d.mimeType,
    fileSize: d.fileSize,
    sha256Hash: d.sha256Hash,
    redactionMetadata: d.redactionMetadata,
    watermarkMetadata: d.watermarkMetadata,
    shareId: d.shareId,
    createdAt: d.createdAt,
    createdBy: d.createdBy ? { fullName: d.createdBy.fullName } : undefined,
  };
}

async function detect(extraction: ExtractionResult): Promise<PiiDetection[]> {
  return getPiiDetectionProvider().detect(extraction.pages.map((p) => ({ pageNumber: p.pageNumber, text: p.text })));
}

/**
 * Confirms a produced redaction really no longer contains any of the
 * redacted values: re-extracts the output's text, looks for each value in
 * normalized form, and re-runs detection comparing keyed fingerprints.
 */
async function verifyRedactionOutput(output: ProcessorOutput, redacted: PiiDetection[]): Promise<{ passed: boolean; reason?: string }> {
  const pages = output.mimeType === "application/pdf" ? await extractPdfPlainText(output.buffer) : [output.buffer.toString("utf-8")];
  const joined = pages.join("\n");
  const digitsCompact = joined.replace(/(?<=\d)[ -](?=\d)/g, "");
  const lower = joined.toLowerCase();
  const collapsed = lower.replace(/\s+/g, " ");

  for (const d of redacted) {
    const present =
      d.type === "AADHAAR_LIKE" || d.type === "PHONE_NUMBER"
        ? digitsCompact.includes(d.normalized)
        : d.type === "ADDRESS_LIKE"
          ? collapsed.includes(d.normalized)
          : lower.includes(d.normalized.toLowerCase());
    if (present) return { passed: false, reason: `A redacted ${PII_TYPE_LABELS[d.type]} value is still present in the output.` };
  }

  const redactedPrints = new Set(redacted.map((d) => piiFingerprint(d.type, d.normalized)));
  const residual = await getPiiDetectionProvider().detect(pages.map((text, i) => ({ pageNumber: i + 1, text })));
  if (residual.some((d) => redactedPrints.has(piiFingerprint(d.type, d.normalized)))) {
    return { passed: false, reason: "Re-scan of the output found a redacted value." };
  }
  return { passed: true };
}

export interface ProduceWatermarkInput {
  user: AuthenticatedUser;
  doc: LoadedDocument;
  version: VersionRecord;
  base: { buffer: Buffer; mimeType: string; parentDerivativeId?: string | null };
  recipient: string;
  purpose: SharePurposeKey;
  purposeNote?: string | null;
  shareId?: string | null;
  requestId: string;
}

export const PrivacyService = {
  async scan(user: AuthenticatedUser, documentId: string, versionNumber: number | undefined, requestId: string) {
    const doc = await loadDocumentOrThrow(documentId);
    await authorize(user, PERMISSIONS.DOCUMENT_SCAN, doc, "PII_SCAN_STARTED", requestId);
    const version = resolveVersion(doc, versionNumber);
    const provider = getPiiDetectionProvider();

    const scan = await prisma.piiScan.create({
      data: { documentId: doc.id, versionId: version.id, status: "RUNNING", provider: provider.name, requestedById: user.id },
    });
    await AuditService.record({
      ...actor(user),
      action: "PII_SCAN_STARTED",
      resource: `pii_scan:${scan.id}`,
      caseId: doc.caseId,
      documentId: doc.id,
      metadata: { scanId: scan.id, versionNumber: version.versionNumber, provider: provider.name, organizationId: user.organizationId },
      requestId,
    });

    let buffer: Buffer;
    try {
      buffer = await readVerifiedVersion(user, doc, version, requestId);
    } catch (err) {
      await prisma.piiScan.update({
        where: { id: scan.id },
        data: { status: "FAILED", statusReason: "Source integrity verification failed.", completedAt: new Date() },
      });
      throw err;
    }

    const extraction = await extractText(buffer, version.mimeType);
    let status: "COMPLETED" | "UNSUPPORTED" = "COMPLETED";
    let statusReason: string | undefined;
    let detections: PiiDetection[] = [];

    if (!extraction.supported) {
      status = "UNSUPPORTED";
      statusReason = extraction.unsupportedReason;
    } else {
      detections = await detect(extraction);
    }

    const limitations = [...extraction.limitations];
    if (provider.coverage.ADDRESS_LIKE === "HEURISTIC_LIMITED") {
      limitations.push("Address detection is heuristic and limited; multi-line or free-form addresses may be missed.");
    }
    limitations.push("Automated detection is not exhaustive. Review the document manually before relying on redaction.");

    const completed = await prisma.$transaction(async (tx) => {
      if (detections.length) {
        await tx.piiFinding.createMany({
          data: detections.map((d) => ({
            scanId: scan.id,
            type: d.type,
            confidence: d.confidence,
            pageNumber: d.pageNumber,
            startOffset: d.start,
            endOffset: d.end,
            maskedPreview: d.maskedPreview,
            detectionMethod: d.detectionMethod,
            fingerprint: piiFingerprint(d.type, d.normalized),
          })),
        });
      }
      return tx.piiScan.update({
        where: { id: scan.id },
        data: {
          status,
          statusReason,
          textLayer: extraction.textLayer,
          pageCount: extraction.pages.length || null,
          findingCount: detections.length,
          limitations,
          completedAt: new Date(),
        },
        include: { findings: { orderBy: [{ pageNumber: "asc" }, { startOffset: "asc" }] }, version: true, requestedBy: true },
      });
    });

    await AuditService.record({
      ...actor(user),
      action: "PII_SCAN_COMPLETED",
      resource: `pii_scan:${scan.id}`,
      caseId: doc.caseId,
      documentId: doc.id,
      result: status === "COMPLETED" ? "SUCCESS" : "ERROR",
      reason: statusReason,
      metadata: {
        scanId: scan.id,
        status,
        findingCount: detections.length,
        countsByType: countByType(detections.map((d) => d.type)),
        textLayer: extraction.textLayer,
      },
      requestId,
    });

    return presentScan(completed, provider.coverage);
  },

  async listScans(user: AuthenticatedUser, documentId: string, requestId: string) {
    const doc = await loadDocumentOrThrow(documentId);
    await authorize(user, PERMISSIONS.DOCUMENT_SCAN, doc, "PII_SCAN_VIEWED", requestId);
    const scans = await prisma.piiScan.findMany({
      where: { documentId },
      orderBy: { startedAt: "desc" },
      take: 20,
      include: { version: true, requestedBy: true },
    });
    return scans.map((s) => presentScan({ ...s, findings: [] }));
  },

  async getScan(user: AuthenticatedUser, documentId: string, scanId: string, requestId: string) {
    const doc = await loadDocumentOrThrow(documentId);
    await authorize(user, PERMISSIONS.DOCUMENT_SCAN, doc, "PII_SCAN_VIEWED", requestId);
    const scan = await prisma.piiScan.findFirst({
      where: { id: scanId, documentId },
      include: { findings: { orderBy: [{ pageNumber: "asc" }, { startOffset: "asc" }] }, version: true, requestedBy: true },
    });
    if (!scan) throw ApiError.notFound("PII scan");
    return presentScan(scan);
  },

  async createRedaction(user: AuthenticatedUser, documentId: string, input: { scanId: string; findingIds: string[] }, requestId: string) {
    const doc = await loadDocumentOrThrow(documentId);
    await authorize(user, PERMISSIONS.DOCUMENT_REDACT, doc, "PII_REDACTION_CREATED", requestId);

    const scan = await prisma.piiScan.findFirst({ where: { id: input.scanId, documentId }, include: { findings: true } });
    if (!scan) throw ApiError.notFound("PII scan");
    if (scan.status !== "COMPLETED") throw ApiError.conflict("SCAN_NOT_COMPLETED", "Redaction requires a completed PII scan.");

    const selectedIds = new Set(input.findingIds);
    const selected = scan.findings.filter((f) => selectedIds.has(f.id));
    if (selected.length !== selectedIds.size) {
      throw ApiError.badRequest("UNKNOWN_FINDING", "One or more selected findings do not belong to this scan.");
    }

    const version = doc.versions.find((v) => v.id === scan.versionId);
    if (!version) throw ApiError.notFound("Document version");

    const derivativeId = uuidv4();
    const baseRecord = {
      id: derivativeId,
      documentId: doc.id,
      sourceVersionId: version.id,
      type: "REDACTED" as const,
      piiScanId: scan.id,
      createdById: user.id,
    };
    const recordOutcome = async (
      status: "FAILED" | "UNSUPPORTED",
      statusReason: string,
    ) => {
      const row = await prisma.documentDerivative.create({
        data: { ...baseRecord, status, statusReason, redactionMetadata: { scanId: scan.id, findingIds: [...selectedIds] } },
        include: { createdBy: true, sourceVersion: true },
      });
      await AuditService.record({
        ...actor(user),
        action: "PII_REDACTION_CREATED",
        resource: `derivative:${derivativeId}`,
        caseId: doc.caseId,
        documentId: doc.id,
        result: "ERROR",
        reason: statusReason,
        metadata: { derivativeId, scanId: scan.id, status, selectedCount: selected.length },
        requestId,
      });
      return presentDerivative(row);
    };

    const processor = getDocumentProcessor(version.mimeType);
    if (!processor || !processor.capabilities.redaction) {
      return recordOutcome("UNSUPPORTED", `Safe redaction is not implemented for ${version.mimeType}. The original is unchanged.`);
    }

    const buffer = await readVerifiedVersion(user, doc, version, requestId);
    const extraction = await extractText(buffer, version.mimeType);
    if (!extraction.supported || !extraction.textLayer) {
      return recordOutcome(
        "UNSUPPORTED",
        extraction.unsupportedReason ?? "No extractable text layer; safe redaction requires OCR, which is not implemented.",
      );
    }

    // Re-locate every reviewed finding in freshly extracted text and confirm
    // it is the same value via its keyed fingerprint.
    const detections = await detect(extraction);
    const toRedact: PiiDetection[] = [];
    for (const f of selected) {
      const match = detections.find(
        (d) =>
          d.type === f.type &&
          d.pageNumber === f.pageNumber &&
          d.start === f.startOffset &&
          d.end === f.endOffset &&
          piiFingerprint(d.type, d.normalized) === f.fingerprint,
      );
      if (!match) {
        return recordOutcome("FAILED", "A selected finding could not be re-located in the source. Run a new scan and try again.");
      }
      toRedact.push(match);
    }

    let output: ProcessorOutput;
    try {
      output = await processor.redact({
        buffer,
        extraction,
        spans: toRedact.map((d) => ({ pageNumber: d.pageNumber, start: d.start, end: d.end, type: d.type })),
      });
    } catch (err) {
      if (err instanceof UnsupportedProcessingError) return recordOutcome("UNSUPPORTED", err.message);
      throw err;
    }

    const verification = await verifyRedactionOutput(output, toRedact);
    if (!verification.passed) {
      return recordOutcome("FAILED", `Post-redaction verification failed: ${verification.reason} No copy was stored.`);
    }

    const storage = getStorageProvider();
    const fileName = `${baseFileName(version.fileName)}.redacted.${output.fileExtension}`;
    const storageKey = buildDerivativeStorageKey(doc.caseId, doc.id, "redacted", derivativeId, fileName);
    await storage.put(storageKey, output.buffer, output.mimeType);
    const hash = sha256(output.buffer);
    const countsByType = countByType(toRedact.map((d) => d.type));

    const row = await prisma.documentDerivative.create({
      data: {
        ...baseRecord,
        status: "COMPLETED",
        storageProvider: storage.id,
        storageKey,
        fileName,
        mimeType: output.mimeType,
        fileSize: output.buffer.length,
        sha256Hash: hash,
        redactionMetadata: {
          scanId: scan.id,
          findingIds: selected.map((f) => f.id),
          redactedCount: toRedact.length,
          countsByType,
          method: output.method,
          processor: processor.name,
          verification: "PASSED",
          notes: output.notes,
        } as Prisma.InputJsonObject,
      },
      include: { createdBy: true, sourceVersion: true },
    });

    await AuditService.record({
      ...actor(user),
      action: "PII_REDACTION_CREATED",
      resource: `derivative:${derivativeId}`,
      caseId: doc.caseId,
      documentId: doc.id,
      metadata: {
        derivativeId,
        scanId: scan.id,
        sourceVersionNumber: version.versionNumber,
        redactedCount: toRedact.length,
        countsByType,
        sha256: hash,
      },
      requestId,
    });

    return presentDerivative(row);
  },

  /** Generates and stores a watermarked copy. Shared by manual watermarking and share delivery. */
  async produceWatermarkedCopy(input: ProduceWatermarkInput) {
    const { user, doc, version, base } = input;
    const derivativeId = uuidv4();
    const purposeText = purposeLabel(input.purpose, input.purposeNote);
    const spec: WatermarkSpec = {
      classification: doc.confidentiality.replace(/_/g, " "),
      caseNumber: doc.case.caseNumber,
      documentNumber: doc.documentNumber,
      recipient: input.recipient,
      purpose: purposeText,
      accessedAt: new Date(),
      copyReference: derivativeId.slice(0, 8).toUpperCase(),
    };
    const watermarkMetadata: Record<string, AuditMetadataValue> = {
      classification: spec.classification,
      caseNumber: spec.caseNumber,
      documentNumber: spec.documentNumber,
      recipient: spec.recipient,
      purpose: input.purpose,
      purposeLabel: purposeText,
      accessedAt: spec.accessedAt.toISOString(),
      copyReference: spec.copyReference,
    };
    const baseRecord = {
      id: derivativeId,
      documentId: doc.id,
      sourceVersionId: version.id,
      parentDerivativeId: base.parentDerivativeId ?? null,
      type: "WATERMARKED" as const,
      shareId: input.shareId ?? null,
      createdById: user.id,
    };

    const processor = getDocumentProcessor(base.mimeType);
    let output: ProcessorOutput | undefined;
    let failure: string | undefined;
    if (!processor || !processor.capabilities.watermark) {
      failure = `Watermarking is not implemented for ${base.mimeType}.`;
    } else {
      try {
        output = await processor.watermark({ buffer: base.buffer, spec });
      } catch (err) {
        if (!(err instanceof UnsupportedProcessingError)) throw err;
        failure = err.message;
      }
    }

    if (!output) {
      const row = await prisma.documentDerivative.create({
        data: { ...baseRecord, status: "UNSUPPORTED", statusReason: failure, watermarkMetadata },
        include: { createdBy: true, sourceVersion: true },
      });
      await AuditService.record({
        ...actor(user),
        action: "WATERMARK_CREATED",
        resource: `derivative:${derivativeId}`,
        caseId: doc.caseId,
        documentId: doc.id,
        result: "ERROR",
        reason: failure,
        metadata: { derivativeId, shareId: input.shareId ?? null, purpose: input.purpose },
        requestId: input.requestId,
      });
      return { derivative: presentDerivative(row), buffer: undefined };
    }

    const storage = getStorageProvider();
    const fileName = `${baseFileName(version.fileName)}.watermarked.${output.fileExtension}`;
    const storageKey = buildDerivativeStorageKey(doc.caseId, doc.id, "watermarked", derivativeId, fileName);
    await storage.put(storageKey, output.buffer, output.mimeType);
    const hash = sha256(output.buffer);

    const row = await prisma.documentDerivative.create({
      data: {
        ...baseRecord,
        status: "COMPLETED",
        storageProvider: storage.id,
        storageKey,
        fileName,
        mimeType: output.mimeType,
        fileSize: output.buffer.length,
        sha256Hash: hash,
        watermarkMetadata: { ...watermarkMetadata, method: output.method, notes: output.notes } as Prisma.InputJsonObject,
      },
      include: { createdBy: true, sourceVersion: true },
    });

    await AuditService.record({
      ...actor(user),
      action: "WATERMARK_CREATED",
      resource: `derivative:${derivativeId}`,
      caseId: doc.caseId,
      documentId: doc.id,
      metadata: {
        derivativeId,
        parentDerivativeId: base.parentDerivativeId ?? null,
        shareId: input.shareId ?? null,
        copyReference: spec.copyReference,
        recipient: spec.recipient,
        purpose: input.purpose,
        sha256: hash,
      },
      requestId: input.requestId,
    });

    return { derivative: presentDerivative(row), buffer: output.buffer };
  },

  async createWatermark(
    user: AuthenticatedUser,
    documentId: string,
    input: { recipient: string; purpose: SharePurposeKey; purposeNote?: string; redactedDerivativeId?: string },
    requestId: string,
  ) {
    const doc = await loadDocumentOrThrow(documentId);
    // A watermarked copy is a downloadable rendition of the document.
    await authorize(user, PERMISSIONS.DOCUMENT_DOWNLOAD, doc, "WATERMARK_CREATED", requestId);

    let base: ProduceWatermarkInput["base"];
    let version: VersionRecord;
    if (input.redactedDerivativeId) {
      const redacted = await prisma.documentDerivative.findFirst({
        where: { id: input.redactedDerivativeId, documentId: doc.id, type: "REDACTED", status: "COMPLETED" },
      });
      if (!redacted) throw ApiError.badRequest("INVALID_DERIVATIVE", "The redacted copy was not found for this document.");
      version = doc.versions.find((v) => v.id === redacted.sourceVersionId)!;
      base = { buffer: await readVerifiedDerivative(redacted), mimeType: redacted.mimeType!, parentDerivativeId: redacted.id };
    } else {
      version = resolveVersion(doc);
      base = { buffer: await readVerifiedVersion(user, doc, version, requestId), mimeType: version.mimeType };
    }

    const { derivative } = await PrivacyService.produceWatermarkedCopy({
      user,
      doc,
      version,
      base,
      recipient: input.recipient,
      purpose: input.purpose,
      purposeNote: input.purposeNote,
      requestId,
    });
    return derivative;
  },

  async listDerivatives(user: AuthenticatedUser, documentId: string, requestId: string) {
    const doc = await loadDocumentOrThrow(documentId);
    await authorize(user, PERMISSIONS.DOCUMENT_VIEW, doc, "DOCUMENT_VIEWED", requestId);
    const rows = await prisma.documentDerivative.findMany({
      where: { documentId },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { createdBy: true, sourceVersion: true },
    });
    return rows.map(presentDerivative);
  },

  async downloadDerivative(user: AuthenticatedUser, documentId: string, derivativeId: string, requestId: string) {
    const doc = await loadDocumentOrThrow(documentId);
    await authorize(user, PERMISSIONS.DOCUMENT_DOWNLOAD, doc, "DOWNLOAD_DENIED", requestId);
    const derivative = await prisma.documentDerivative.findFirst({ where: { id: derivativeId, documentId } });
    if (!derivative) throw ApiError.notFound("Derived copy");
    if (derivative.status !== "COMPLETED") throw ApiError.conflict("DERIVATIVE_NOT_READY", "This derived copy is not available.");
    const buffer = await readVerifiedDerivative(derivative);

    await AuditService.record({
      ...actor(user),
      action: "DOCUMENT_DOWNLOADED",
      resource: `derivative:${derivative.id}`,
      caseId: doc.caseId,
      documentId: doc.id,
      metadata: { derivativeId: derivative.id, derivativeType: derivative.type, sha256: derivative.sha256Hash },
      requestId,
    });
    return { buffer, fileName: derivative.fileName!, mimeType: derivative.mimeType! };
  },
};
