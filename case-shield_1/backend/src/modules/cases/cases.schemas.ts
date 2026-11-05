import { z } from "zod";

export const CaseStatusEnum = z.enum(["ACTIVE", "UNDER_REVIEW", "ON_HOLD", "CLOSED", "ARCHIVED"]);
export const CasePriorityEnum = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
export const ConfidentialityEnum = z.enum(["PUBLIC", "INTERNAL", "CONFIDENTIAL", "HIGHLY_CONFIDENTIAL", "RESTRICTED"]);

// Human-facing case reference, e.g. CASE-2026-00427. Optional on create:
// when omitted the server assigns the next free number.
export const CaseNumberSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^CASE-\d{4}-\d{5}$/, "Case number must look like CASE-2026-00427.");

export const CreateCaseSchema = z.object({
  caseNumber: CaseNumberSchema.optional(),
  title: z.string().trim().min(3).max(300),
  categoryId: z.string().uuid(),
  typeId: z.string().uuid(),
  court: z.string().min(1),
  jurisdiction: z.string().trim().max(200).optional().default(""),
  priority: CasePriorityEnum.default("MEDIUM"),
  confidentiality: ConfidentialityEnum.default("INTERNAL"),
  investigatingOfficerId: z.string().uuid().optional(),
  description: z.string().min(1),
  tags: z.array(z.string()).optional().default([]),
});

export const UpdateCaseSchema = z
  .object({
    title: z.string().trim().min(3).max(300).optional(),
    categoryId: z.string().uuid().optional(),
    typeId: z.string().uuid().optional(),
    status: CaseStatusEnum.optional(),
    priority: CasePriorityEnum.optional(),
    confidentiality: ConfidentialityEnum.optional(),
    court: z.string().trim().min(1).optional(),
    jurisdiction: z.string().trim().max(200).optional(),
    description: z.string().trim().min(1).optional(),
    investigatingOfficerId: z.string().uuid().optional(),
  })
  .strict()
  .refine((v) => !v.categoryId || !!v.typeId, { message: "typeId is required when changing the category.", path: ["typeId"] });

export const AssignCaseSchema = z.object({
  userId: z.string().uuid(),
  roleOnCase: z.string().min(1),
});

export const ListCasesQuerySchema = z.object({
  status: CaseStatusEnum.optional(),
  priority: CasePriorityEnum.optional(),
  categoryId: z.string().uuid().optional(),
  court: z.string().optional(),
  q: z.string().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(20),
});
