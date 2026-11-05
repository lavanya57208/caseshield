import { z } from "zod";
import { SHARE_PURPOSES } from "@/modules/sharing/share-purposes";

export const DocumentIdParamsSchema = z.object({ id: z.string().uuid() });
export const ScanParamsSchema = z.object({ id: z.string().uuid(), scanId: z.string().uuid() });
export const DerivativeParamsSchema = z.object({ id: z.string().uuid(), derivativeId: z.string().uuid() });

export const StartScanSchema = z.object({
  versionNumber: z.coerce.number().int().min(1).optional(),
});

export const CreateRedactionSchema = z.object({
  scanId: z.string().uuid(),
  findingIds: z.array(z.string().uuid()).min(1, "Select at least one finding to redact.").max(500),
});

export const CreateWatermarkSchema = z
  .object({
    recipient: z.string().trim().min(2).max(120),
    purpose: z.enum(SHARE_PURPOSES),
    purposeNote: z.string().trim().max(200).optional(),
    redactedDerivativeId: z.string().uuid().optional(),
  })
  .refine((v) => v.purpose !== "OTHER" || !!v.purposeNote, { message: "Describe the purpose when selecting Other.", path: ["purposeNote"] });
