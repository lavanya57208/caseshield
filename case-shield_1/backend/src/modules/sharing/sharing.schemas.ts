import { z } from "zod";
import { SHARE_PURPOSES } from "@/modules/sharing/share-purposes";

export const ShareIdParamsSchema = z.object({ id: z.string().uuid() });

export const CreateShareSchema = z
  .object({
    documentId: z.string().uuid(),
    recipientUserId: z.string().uuid(),
    recipientOrganization: z.string().trim().min(2).max(120).optional(),
    purpose: z.enum(SHARE_PURPOSES),
    purposeNote: z.string().trim().max(200).optional(),
    startsAt: z.coerce.date().optional(),
    expiresAt: z.coerce.date(),
    allowDownload: z.boolean().default(false),
    applyRedaction: z.boolean().default(false),
    redactedDerivativeId: z.string().uuid().optional(),
    applyWatermark: z.boolean().default(true),
    requireApproval: z.boolean().default(true),
  })
  .refine((v) => v.purpose !== "OTHER" || !!v.purposeNote, {
    message: "Describe the purpose when selecting Other.",
    path: ["purposeNote"],
  })
  .refine((v) => !v.applyRedaction || !!v.redactedDerivativeId, {
    message: "Create a redacted copy first, or turn off redaction.",
    path: ["redactedDerivativeId"],
  });

export const ReviewShareSchema = z.object({
  note: z.string().trim().max(500).optional(),
});

export const ListSharesQuerySchema = z.object({
  scope: z.enum(["incoming", "outgoing", "approvals", "document"]).default("incoming"),
  documentId: z.string().uuid().optional(),
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "EXPIRED", "REVOKED"]).optional(),
});

export const RecipientsQuerySchema = z.object({
  documentId: z.string().uuid(),
});
