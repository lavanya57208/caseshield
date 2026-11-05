-- CreateEnum
CREATE TYPE "PiiScanStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED', 'UNSUPPORTED');

-- CreateEnum
CREATE TYPE "PiiType" AS ENUM ('AADHAAR_LIKE', 'PHONE_NUMBER', 'EMAIL_ADDRESS', 'IP_ADDRESS', 'ADDRESS_LIKE');

-- CreateEnum
CREATE TYPE "PiiConfidence" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "DerivativeType" AS ENUM ('REDACTED', 'WATERMARKED');

-- CreateEnum
CREATE TYPE "DerivativeStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'UNSUPPORTED');

-- CreateEnum
CREATE TYPE "SharePurpose" AS ENUM ('INVESTIGATION', 'FORENSIC_EXAMINATION', 'COURT_FILING', 'LEGAL_REVIEW', 'EVIDENCE_VERIFICATION', 'ADMINISTRATIVE_REVIEW', 'OTHER');

-- AlterTable
ALTER TABLE "audit_events" ADD COLUMN     "metadata" JSONB;

-- CreateTable
CREATE TABLE "pii_scans" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "status" "PiiScanStatus" NOT NULL DEFAULT 'RUNNING',
    "provider" TEXT NOT NULL,
    "textLayer" BOOLEAN NOT NULL DEFAULT false,
    "pageCount" INTEGER,
    "findingCount" INTEGER NOT NULL DEFAULT 0,
    "limitations" JSONB,
    "statusReason" TEXT,
    "requestedById" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "pii_scans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pii_findings" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "type" "PiiType" NOT NULL,
    "confidence" "PiiConfidence" NOT NULL,
    "pageNumber" INTEGER,
    "startOffset" INTEGER NOT NULL,
    "endOffset" INTEGER NOT NULL,
    "maskedPreview" TEXT NOT NULL,
    "detectionMethod" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,

    CONSTRAINT "pii_findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_derivatives" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "sourceVersionId" TEXT NOT NULL,
    "parentDerivativeId" TEXT,
    "type" "DerivativeType" NOT NULL,
    "status" "DerivativeStatus" NOT NULL DEFAULT 'PENDING',
    "statusReason" TEXT,
    "storageProvider" TEXT,
    "storageKey" TEXT,
    "fileName" TEXT,
    "mimeType" TEXT,
    "fileSize" INTEGER,
    "sha256Hash" TEXT,
    "piiScanId" TEXT,
    "redactionMetadata" JSONB,
    "watermarkMetadata" JSONB,
    "shareId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_derivatives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_shares" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "sourceVersionId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "recipientUserId" TEXT NOT NULL,
    "recipientOrganization" TEXT,
    "purpose" "SharePurpose" NOT NULL,
    "purposeNote" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "allowDownload" BOOLEAN NOT NULL DEFAULT false,
    "applyRedaction" BOOLEAN NOT NULL DEFAULT false,
    "baseDerivativeId" TEXT,
    "applyWatermark" BOOLEAN NOT NULL DEFAULT true,
    "requireApproval" BOOLEAN NOT NULL DEFAULT true,
    "status" "AccessRequestStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "revokedById" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_shares_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pii_scans_documentId_startedAt_idx" ON "pii_scans"("documentId", "startedAt");

-- CreateIndex
CREATE INDEX "pii_findings_scanId_idx" ON "pii_findings"("scanId");

-- CreateIndex
CREATE INDEX "document_derivatives_documentId_createdAt_idx" ON "document_derivatives"("documentId", "createdAt");

-- CreateIndex
CREATE INDEX "document_derivatives_sourceVersionId_idx" ON "document_derivatives"("sourceVersionId");

-- CreateIndex
CREATE INDEX "document_derivatives_shareId_idx" ON "document_derivatives"("shareId");

-- CreateIndex
CREATE INDEX "document_shares_recipientUserId_status_idx" ON "document_shares"("recipientUserId", "status");

-- CreateIndex
CREATE INDEX "document_shares_documentId_status_idx" ON "document_shares"("documentId", "status");

-- CreateIndex
CREATE INDEX "document_shares_caseId_idx" ON "document_shares"("caseId");

-- AddForeignKey
ALTER TABLE "pii_scans" ADD CONSTRAINT "pii_scans_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pii_scans" ADD CONSTRAINT "pii_scans_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "document_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pii_scans" ADD CONSTRAINT "pii_scans_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pii_findings" ADD CONSTRAINT "pii_findings_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "pii_scans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_derivatives" ADD CONSTRAINT "document_derivatives_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_derivatives" ADD CONSTRAINT "document_derivatives_sourceVersionId_fkey" FOREIGN KEY ("sourceVersionId") REFERENCES "document_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_derivatives" ADD CONSTRAINT "document_derivatives_parentDerivativeId_fkey" FOREIGN KEY ("parentDerivativeId") REFERENCES "document_derivatives"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_derivatives" ADD CONSTRAINT "document_derivatives_shareId_fkey" FOREIGN KEY ("shareId") REFERENCES "document_shares"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_derivatives" ADD CONSTRAINT "document_derivatives_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_shares" ADD CONSTRAINT "document_shares_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_shares" ADD CONSTRAINT "document_shares_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_shares" ADD CONSTRAINT "document_shares_sourceVersionId_fkey" FOREIGN KEY ("sourceVersionId") REFERENCES "document_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_shares" ADD CONSTRAINT "document_shares_baseDerivativeId_fkey" FOREIGN KEY ("baseDerivativeId") REFERENCES "document_derivatives"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_shares" ADD CONSTRAINT "document_shares_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_shares" ADD CONSTRAINT "document_shares_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_shares" ADD CONSTRAINT "document_shares_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_shares" ADD CONSTRAINT "document_shares_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
