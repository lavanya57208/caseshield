import { z } from "zod";

export const DocumentTypeEnum = z.enum([
  "FIR",
  "POLICE_REPORT",
  "INVESTIGATION_REPORT",
  "INVESTIGATION_RECORD",
  "WITNESS_STATEMENT",
  "CHARGE_SHEET",
  "COURT_FILING",
  "EVIDENCE_RECORD",
  "FORENSIC_REPORT",
  "LEGAL_NOTICE",
  "JUDGMENT",
  "ORDER",
  "SUPPORTING_DOCUMENT",
]);

export const ConfidentialityEnum = z.enum(["PUBLIC", "INTERNAL", "CONFIDENTIAL", "HIGHLY_CONFIDENTIAL", "RESTRICTED"]);

export const UploadDocumentMetaSchema = z.object({
  caseId: z.string().uuid(),
  type: DocumentTypeEnum,
  title: z.string().min(1).max(300),
  description: z.string().optional(),
  confidentiality: ConfidentialityEnum.default("INTERNAL"),
  tags: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").map((t) => t.trim()).filter(Boolean) : [])),
});

export const NewVersionMetaSchema = z.object({
  changeNote: z.string().min(1),
});

export const VerifyQuerySchema = z.object({
  versionNumber: z.coerce.number().optional(),
});

export const ListDocumentsQuerySchema = z.object({
  caseId: z.string().uuid(),
  type: DocumentTypeEnum.optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(25),
});
