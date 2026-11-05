-- Phase 3 — Evidence management, hash-linked chain of custody, advanced audit.
--
-- Hand-edited from `prisma migrate diff` output so that EXISTING rows are
-- preserved: enum values are remapped rather than cast blindly, legacy
-- columns are renamed rather than dropped, and custody events are numbered.
-- Hashes for pre-existing custody events are NOT computed here (the
-- canonical serialization lives in application code); `npm run prisma:seed`
-- seals any legacy chain via sealLegacyCustodyChains(). Until then the
-- custody-chain verifier reports those events as UNSEALED.

-- CreateEnum
CREATE TYPE "EvidenceTransferStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED');

-- AlterEnum: CustodyAction (RELEASED -> RETURNED; all others kept)
CREATE TYPE "CustodyAction_new" AS ENUM ('COLLECTED', 'REGISTERED', 'TRANSFERRED', 'RECEIVED', 'TRANSFER_REJECTED', 'TRANSFER_CANCELLED', 'EXAMINED', 'SEALED', 'UNSEALED', 'SUBMITTED', 'RETURNED', 'ARCHIVED', 'VIEWED', 'VERIFIED');
ALTER TABLE "custody_events" ALTER COLUMN "action" TYPE "CustodyAction_new" USING (
  CASE "action"::text
    WHEN 'RELEASED' THEN 'RETURNED'
    ELSE "action"::text
  END
)::"CustodyAction_new";
ALTER TYPE "CustodyAction" RENAME TO "CustodyAction_old";
ALTER TYPE "CustodyAction_new" RENAME TO "CustodyAction";
DROP TYPE "CustodyAction_old";

-- AlterEnum: EvidenceStatus (Phase 1 values mapped to the Phase 3 lifecycle)
CREATE TYPE "EvidenceStatus_new" AS ENUM ('REGISTERED', 'IN_CUSTODY', 'UNDER_EXAMINATION', 'TRANSFERRED', 'SUBMITTED_TO_COURT', 'RETURNED', 'SEALED', 'ARCHIVED');
ALTER TABLE "evidence" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "evidence" ALTER COLUMN "status" TYPE "EvidenceStatus_new" USING (
  CASE "status"::text
    WHEN 'COLLECTED' THEN 'REGISTERED'
    WHEN 'IN_TRANSIT' THEN 'TRANSFERRED'
    WHEN 'SUBMITTED' THEN 'SUBMITTED_TO_COURT'
    WHEN 'RELEASED' THEN 'RETURNED'
    ELSE "status"::text
  END
)::"EvidenceStatus_new";
ALTER TYPE "EvidenceStatus" RENAME TO "EvidenceStatus_old";
ALTER TYPE "EvidenceStatus_new" RENAME TO "EvidenceStatus";
DROP TYPE "EvidenceStatus_old";
ALTER TABLE "evidence" ALTER COLUMN "status" SET DEFAULT 'REGISTERED';

-- A legacy IN_TRANSIT item has no EvidenceTransfer row to accept, so it is
-- returned to IN_CUSTODY with its current custodian rather than left stuck.
UPDATE "evidence" e SET "status" = 'IN_CUSTODY'
WHERE e."status" = 'TRANSFERRED';

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'EVIDENCE_TRANSFER_REJECTED';

-- AlterTable: audit_events
ALTER TABLE "audit_events" ADD COLUMN "organizationId" TEXT;
UPDATE "audit_events" a SET "organizationId" = c."organizationId"
FROM "cases" c WHERE a."caseId" = c."id" AND a."organizationId" IS NULL;
UPDATE "audit_events" a SET "organizationId" = u."organizationId"
FROM "users" u WHERE a."actorId" = u."id" AND a."organizationId" IS NULL;
-- Audit rows pointing at evidence that no longer exists cannot satisfy the
-- new foreign key; keep the row, drop the dangling reference.
UPDATE "audit_events" a SET "evidenceId" = NULL
WHERE a."evidenceId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "evidence" e WHERE e."id" = a."evidenceId");

-- AlterTable: custody_events
ALTER TABLE "custody_events" RENAME COLUMN "authorizedBy" TO "actorId";
ALTER TABLE "custody_events"
ADD COLUMN "eventHash" TEXT,
ADD COLUMN "notes" TEXT,
ADD COLUMN "organizationId" TEXT,
ADD COLUMN "previousEventHash" TEXT,
ADD COLUMN "sequence" INTEGER,
ADD COLUMN "transferId" TEXT;

UPDATE "custody_events" ce SET "organizationId" = c."organizationId"
FROM "evidence" e JOIN "cases" c ON c."id" = e."caseId"
WHERE ce."evidenceId" = e."id";

UPDATE "custody_events" ce SET "sequence" = numbered.seq
FROM (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "evidenceId" ORDER BY "occurredAt", "id") AS seq
  FROM "custody_events"
) numbered
WHERE ce."id" = numbered."id";

ALTER TABLE "custody_events" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "custody_events" ALTER COLUMN "sequence" SET NOT NULL;

-- AlterTable: evidence
ALTER TABLE "evidence" RENAME COLUMN "integrityHash" TO "originalHash";
ALTER TABLE "evidence"
ADD COLUMN "currentHash" TEXT,
ADD COLUMN "custodyEventCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "custodyHeadHash" TEXT,
ADD COLUMN "integrityStatus" "IntegrityStatus",
ADD COLUMN "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "lastVerifiedAt" TIMESTAMP(3),
ADD COLUMN "originalDocumentId" TEXT,
ADD COLUMN "originalVersionId" TEXT,
ADD COLUMN "registeredById" TEXT,
ADD COLUMN "source" TEXT,
ADD COLUMN "submittedAt" TIMESTAMP(3),
ADD COLUMN "title" TEXT,
ALTER COLUMN "location" DROP NOT NULL;

UPDATE "evidence" SET
  "title" = LEFT("description", 120),
  "registeredById" = "collectedById",
  "currentHash" = "originalHash";

UPDATE "evidence" e SET
  "custodyEventCount" = agg.n,
  "lastActivityAt" = agg.last_at
FROM (
  SELECT "evidenceId", COUNT(*)::int AS n, MAX("occurredAt") AS last_at
  FROM "custody_events" GROUP BY "evidenceId"
) agg
WHERE e."id" = agg."evidenceId";

-- Phase 1 evidence type catalog -> Phase 3 catalog.
UPDATE "evidence" SET "type" = CASE "type"
  WHEN 'DOCUMENTARY_EVIDENCE' THEN 'DOCUMENT'
  WHEN 'LABORATORY_REPORT' THEN 'FORENSIC_REPORT'
  WHEN 'DEVICE_IMAGE' THEN 'DIGITAL_EVIDENCE'
  WHEN 'FORENSIC_SAMPLE' THEN 'PHYSICAL_EVIDENCE'
  ELSE "type"
END;

ALTER TABLE "evidence" ALTER COLUMN "title" SET NOT NULL;
ALTER TABLE "evidence" ALTER COLUMN "registeredById" SET NOT NULL;

-- AlterTable: notifications
ALTER TABLE "notifications" ADD COLUMN "relatedEvidenceId" TEXT;

-- CreateTable
CREATE TABLE "evidence_transfers" (
    "id" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "fromCustodianId" TEXT NOT NULL,
    "toCustodianId" TEXT NOT NULL,
    "initiatedById" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "notes" TEXT,
    "status" "EvidenceTransferStatus" NOT NULL DEFAULT 'PENDING',
    "previousStatus" "EvidenceStatus" NOT NULL,
    "responseNote" TEXT,
    "initiatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "evidence_transfers_pkey" PRIMARY KEY ("id")
);

-- At most one PENDING transfer per evidence item (defence in depth; the
-- service also serializes transfers with a row lock).
CREATE UNIQUE INDEX "evidence_transfers_one_pending_per_evidence"
ON "evidence_transfers"("evidenceId") WHERE "status" = 'PENDING';

-- CreateIndex
CREATE INDEX "evidence_transfers_evidenceId_status_idx" ON "evidence_transfers"("evidenceId", "status");
CREATE INDEX "evidence_transfers_toCustodianId_status_idx" ON "evidence_transfers"("toCustodianId", "status");
CREATE INDEX "audit_events_evidenceId_occurredAt_idx" ON "audit_events"("evidenceId", "occurredAt");
CREATE INDEX "audit_events_organizationId_occurredAt_idx" ON "audit_events"("organizationId", "occurredAt");
CREATE INDEX "custody_events_actorId_idx" ON "custody_events"("actorId");
CREATE UNIQUE INDEX "custody_events_evidenceId_sequence_key" ON "custody_events"("evidenceId", "sequence");
CREATE INDEX "evidence_caseId_status_idx" ON "evidence"("caseId", "status");
CREATE INDEX "evidence_currentCustodianId_idx" ON "evidence"("currentCustodianId");
CREATE INDEX "evidence_originalDocumentId_idx" ON "evidence"("originalDocumentId");

-- AddForeignKey
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_registeredById_fkey" FOREIGN KEY ("registeredById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_originalDocumentId_fkey" FOREIGN KEY ("originalDocumentId") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_originalVersionId_fkey" FOREIGN KEY ("originalVersionId") REFERENCES "document_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "custody_events" ADD CONSTRAINT "custody_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "custody_events" ADD CONSTRAINT "custody_events_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "evidence_transfers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "evidence_transfers" ADD CONSTRAINT "evidence_transfers_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "evidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "evidence_transfers" ADD CONSTRAINT "evidence_transfers_fromCustodianId_fkey" FOREIGN KEY ("fromCustodianId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "evidence_transfers" ADD CONSTRAINT "evidence_transfers_toCustodianId_fkey" FOREIGN KEY ("toCustodianId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "evidence_transfers" ADD CONSTRAINT "evidence_transfers_initiatedById_fkey" FOREIGN KEY ("initiatedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "evidence"("id") ON DELETE SET NULL ON UPDATE CASCADE;
