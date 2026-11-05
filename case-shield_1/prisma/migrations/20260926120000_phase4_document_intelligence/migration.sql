-- Phase 4 — AI/OCR document intelligence + authorization-aware search.
-- Adds one derived-data table (document_intelligence), extends the existing
-- AI job table/enums, and adds search-friendly indexes. Original files stay
-- in object storage; nothing here stores document binaries.
--
-- "searchVector" is maintained by a BEFORE INSERT/UPDATE trigger (defined at
-- the end of this file) so the full-text index can never drift from the
-- stored, PII-masked text. Weight A = extracted metadata values, weight B =
-- body text. A trigger (rather than a generated column) keeps the column
-- invisible to Prisma's schema diffing.

-- CreateEnum
CREATE TYPE "DocumentProcessingStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "TextExtractionStatus" AS ENUM ('QUEUED', 'PROCESSING', 'TEXT_EXTRACTED', 'OCR_PROCESSED', 'PARTIAL', 'FAILED', 'UNSUPPORTED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "TextSource" AS ENUM ('TEXT_LAYER', 'OCR', 'NONE');

-- CreateEnum
CREATE TYPE "IntelligenceStepStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'SKIPPED', 'FAILED');

-- CreateEnum
CREATE TYPE "IntelligenceReviewStatus" AS ENUM ('PENDING_REVIEW', 'CONFIRMED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AiProvenance" AS ENUM ('AI_GENERATED', 'AI_ASSISTED', 'HUMAN_CONFIRMED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AiJobStatus" ADD VALUE IF NOT EXISTS 'PROCESSING';
ALTER TYPE "AiJobStatus" ADD VALUE IF NOT EXISTS 'PARTIAL';

-- AlterEnum
ALTER TYPE "AiJobType" ADD VALUE IF NOT EXISTS 'PROCESS_DOCUMENT';

-- AlterTable
ALTER TABLE "ai_processing_jobs" ADD COLUMN     "attempt" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "error" TEXT,
ADD COLUMN     "intelligenceId" TEXT,
ADD COLUMN     "provider" TEXT,
ADD COLUMN     "startedAt" TIMESTAMP(3),
ADD COLUMN     "versionId" TEXT;

-- CreateTable
CREATE TABLE "document_intelligence" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "processingStatus" "DocumentProcessingStatus" NOT NULL DEFAULT 'QUEUED',
    "processingError" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "requestedById" TEXT,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "extractionStatus" "TextExtractionStatus" NOT NULL DEFAULT 'QUEUED',
    "textSource" "TextSource",
    "extractionProvider" TEXT,
    "extractionConfidence" DOUBLE PRECISION,
    "language" TEXT,
    "pageCount" INTEGER,
    "characterCount" INTEGER,
    "extractionLimitations" JSONB,
    "extractionError" TEXT,
    "maskedText" TEXT,
    "classificationStatus" "IntelligenceStepStatus" NOT NULL DEFAULT 'PENDING',
    "classificationReason" TEXT,
    "suggestedType" TEXT,
    "classificationConfidence" DOUBLE PRECISION,
    "classificationProvider" TEXT,
    "classificationReview" "IntelligenceReviewStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "classificationProvenance" "AiProvenance",
    "confirmedType" TEXT,
    "classificationReviewedBy" TEXT,
    "classificationReviewedAt" TIMESTAMP(3),
    "metadataStatus" "IntelligenceStepStatus" NOT NULL DEFAULT 'PENDING',
    "metadataReason" TEXT,
    "extractedMetadata" JSONB,
    "metadataProvider" TEXT,
    "metadataReview" "IntelligenceReviewStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "metadataProvenance" "AiProvenance",
    "confirmedMetadata" JSONB,
    "metadataReviewedBy" TEXT,
    "metadataReviewedAt" TIMESTAMP(3),
    "metadataText" TEXT,
    "summaryStatus" "IntelligenceStepStatus" NOT NULL DEFAULT 'PENDING',
    "summaryReason" TEXT,
    "summary" TEXT,
    "summaryProvider" TEXT,
    "summaryGeneratedAt" TIMESTAMP(3),
    "piiStatus" "IntelligenceStepStatus" NOT NULL DEFAULT 'PENDING',
    "piiFindingCount" INTEGER,
    "piiTypeCounts" JSONB,
    "indexStatus" "IntelligenceStepStatus" NOT NULL DEFAULT 'PENDING',
    "indexedAt" TIMESTAMP(3),
    "searchVector" tsvector,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_intelligence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "document_intelligence_versionId_key" ON "document_intelligence"("versionId");

-- CreateIndex
CREATE INDEX "document_intelligence_documentId_idx" ON "document_intelligence"("documentId");

-- CreateIndex
CREATE INDEX "document_intelligence_caseId_idx" ON "document_intelligence"("caseId");

-- CreateIndex
CREATE INDEX "document_intelligence_suggestedType_idx" ON "document_intelligence"("suggestedType");

-- CreateIndex
CREATE INDEX "document_intelligence_processingStatus_idx" ON "document_intelligence"("processingStatus");

-- CreateIndex
CREATE INDEX "document_intelligence_createdAt_idx" ON "document_intelligence"("createdAt");

-- CreateIndex
CREATE INDEX "document_intelligence_searchVector_idx" ON "document_intelligence" USING GIN ("searchVector");

-- CreateIndex
CREATE INDEX "ai_processing_jobs_documentId_createdAt_idx" ON "ai_processing_jobs"("documentId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_processing_jobs_intelligenceId_idx" ON "ai_processing_jobs"("intelligenceId");

-- CreateIndex
CREATE INDEX "documents_caseId_type_idx" ON "documents"("caseId", "type");

-- CreateIndex
CREATE INDEX "documents_createdAt_idx" ON "documents"("createdAt");

-- AddForeignKey
ALTER TABLE "ai_processing_jobs" ADD CONSTRAINT "ai_processing_jobs_intelligenceId_fkey" FOREIGN KEY ("intelligenceId") REFERENCES "document_intelligence"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_intelligence" ADD CONSTRAINT "document_intelligence_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_intelligence" ADD CONSTRAINT "document_intelligence_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "document_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Full-text search vector maintenance (see header comment).
CREATE FUNCTION document_intelligence_search_vector_update() RETURNS trigger AS $$
BEGIN
    NEW."searchVector" :=
        setweight(to_tsvector('english', coalesce(NEW."metadataText", '')), 'A') ||
        setweight(to_tsvector('english', coalesce(NEW."maskedText", '')), 'B');
    RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER document_intelligence_search_vector
    BEFORE INSERT OR UPDATE OF "metadataText", "maskedText" ON "document_intelligence"
    FOR EACH ROW EXECUTE FUNCTION document_intelligence_search_vector_update();
