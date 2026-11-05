import { z } from "zod";

export const CreateAccessRequestSchema = z.object({
  caseId: z.string().uuid(),
  documentId: z.string().uuid().optional(),
  permissionKey: z.string().min(1),
  reason: z.string().min(1),
  durationDays: z.coerce.number().min(1).max(365).optional(),
});

export const ReviewAccessRequestSchema = z.object({
  reviewNote: z.string().optional(),
});

export const ListAccessRequestsQuerySchema = z.object({
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "EXPIRED", "REVOKED"]).optional(),
  caseId: z.string().uuid().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(25),
});
