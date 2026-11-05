import { Router } from "express";
import { z } from "zod";
import { authenticate, requireAuth } from "@/middleware/auth";
import { validate } from "@/middleware/validate";
import { DOCUMENT_CLASSIFICATION_TYPES } from "@/modules/ai/ai-provider.types";
import { IntelligenceService } from "@/modules/ai/intelligence/intelligence.service";

// Mounted under /api/documents — see docs/api.md §Document Intelligence.
const router = Router();

const IdParam = z.object({ id: z.string().uuid() });

const ClassificationReviewSchema = z
  .object({
    decision: z.enum(["CONFIRM", "CORRECT", "REJECT"]),
    type: z.enum(DOCUMENT_CLASSIFICATION_TYPES).optional(),
    applyToDocument: z.boolean().optional().default(false),
    note: z.string().max(500).optional(),
  })
  .refine((v) => v.decision !== "CORRECT" || !!v.type, { message: "type is required when decision is CORRECT", path: ["type"] });

const metaString = z.string().trim().max(300).nullable();
const MetadataReviewSchema = z
  .object({
    decision: z.enum(["CONFIRM", "CORRECT", "REJECT"]),
    metadata: z
      .object({
        caseNumber: metaString,
        documentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "documentDate must be yyyy-mm-dd").nullable(),
        documentTitle: metaString,
        author: metaString,
        department: metaString,
        evidenceIds: z.array(z.string().trim().min(1).max(50)).max(50).nullable(),
        tags: z.array(z.string().trim().min(1).max(50)).max(30).nullable(),
      })
      .partial()
      .strict()
      .optional(),
    note: z.string().max(500).optional(),
  })
  .refine((v) => v.decision !== "CORRECT" || (v.metadata && Object.keys(v.metadata).length > 0), {
    message: "metadata is required when decision is CORRECT",
    path: ["metadata"],
  });

router.get("/:id/intelligence", authenticate, requireAuth, validate(IdParam, "params"), async (req, res, next) => {
  try {
    res.json(await IntelligenceService.get(req.user!, req.params.id, req.requestId));
  } catch (err) {
    next(err);
  }
});

router.post("/:id/intelligence/reprocess", authenticate, requireAuth, validate(IdParam, "params"), async (req, res, next) => {
  try {
    res.status(202).json(await IntelligenceService.reprocess(req.user!, req.params.id, req.requestId));
  } catch (err) {
    next(err);
  }
});

router.post("/:id/intelligence/summary", authenticate, requireAuth, validate(IdParam, "params"), async (req, res, next) => {
  try {
    res.json({ intelligence: await IntelligenceService.regenerateSummary(req.user!, req.params.id, req.requestId) });
  } catch (err) {
    next(err);
  }
});

router.post(
  "/:id/intelligence/classification/review",
  authenticate,
  requireAuth,
  validate(IdParam, "params"),
  validate(ClassificationReviewSchema),
  async (req, res, next) => {
    try {
      res.json({ intelligence: await IntelligenceService.reviewClassification(req.user!, req.params.id, req.body, req.requestId) });
    } catch (err) {
      next(err);
    }
  },
);

router.post("/:id/intelligence/metadata/review", authenticate, requireAuth, validate(IdParam, "params"), validate(MetadataReviewSchema), async (req, res, next) => {
  try {
    res.json({ intelligence: await IntelligenceService.reviewMetadata(req.user!, req.params.id, req.body, req.requestId) });
  } catch (err) {
    next(err);
  }
});

export default router;
