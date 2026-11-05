import { z } from "zod";
import { DIRECT_ACTIONS, EVIDENCE_STATUSES } from "@/modules/evidence/evidence-lifecycle";

// Evidence categories. Stored as a string column so the catalog can grow
// without a migration — add a value here (and its frontend label).
export const EVIDENCE_TYPES = [
  "DOCUMENT",
  "PHOTOGRAPH",
  "VIDEO",
  "AUDIO",
  "FORENSIC_REPORT",
  "DIGITAL_EVIDENCE",
  "PHYSICAL_EVIDENCE",
  "DEVICE",
  "BIOLOGICAL_SAMPLE",
  "OTHER",
] as const;

export const EvidenceTypeEnum = z.enum(EVIDENCE_TYPES);
export const ConfidentialityEnum = z.enum(["PUBLIC", "INTERNAL", "CONFIDENTIAL", "HIGHLY_CONFIDENTIAL", "RESTRICTED"]);

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

export const IdParamsSchema = z.object({ id: z.string().uuid() });
export const TransferParamsSchema = z.object({ id: z.string().uuid(), transferId: z.string().uuid() });

export const RegisterEvidenceSchema = z.object({
  caseId: z.string().uuid(),
  title: text(200),
  type: EvidenceTypeEnum,
  description: text(4000),
  source: optionalText(200),
  collectedAt: z.coerce.date().refine((d) => d.getTime() <= Date.now() + 5 * 60 * 1000, "Collection time cannot be in the future."),
  // Defaults to the authenticated user. Never trusted blindly: must be an
  // active member of the case's organization with access to the case.
  collectedById: z.string().uuid().optional(),
  initialCustodianId: z.string().uuid().optional(),
  location: optionalText(300),
  confidentiality: ConfidentialityEnum.default("INTERNAL"),
  notes: optionalText(2000),
  // Optional link to an existing document in the same case (digital evidence).
  documentId: z.string().uuid().optional(),
  versionNumber: z.coerce.number().int().min(1).optional(),
});

export const ListEvidenceQuerySchema = z.object({
  caseId: z.string().uuid(),
  status: z.enum(EVIDENCE_STATUSES).optional(),
  type: EvidenceTypeEnum.optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

export const CandidatesQuerySchema = z.object({
  caseId: z.string().uuid(),
  confidentiality: ConfidentialityEnum.default("INTERNAL"),
});

export const InitiateTransferSchema = z.object({
  toUserId: z.string().uuid(),
  reason: z.string().trim().min(3, "A reason for the transfer is required.").max(500),
  notes: optionalText(2000),
});

export const RespondTransferSchema = z.object({
  notes: optionalText(2000),
});

export const RejectTransferSchema = z.object({
  reason: z.string().trim().min(3, "A reason is required.").max(500),
});

export const EvidenceActionSchema = z.object({
  action: z.enum(DIRECT_ACTIONS),
  reason: z.string().trim().min(3, "A reason is required.").max(500),
  notes: optionalText(2000),
});
