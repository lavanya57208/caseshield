import { Router } from "express";
import { z } from "zod";
import { authenticate, requireAuth } from "@/middleware/auth";
import { validate } from "@/middleware/validate";
import { AiService } from "@/modules/ai/ai.service";

const router = Router();

const DocIdSchema = z.object({ documentId: z.string().uuid() });

router.post("/extract-metadata", authenticate, requireAuth, validate(DocIdSchema), async (req, res, next) => {
  try {
    res.status(201).json({ job: await AiService.extractMetadata(req.user!, req.body.documentId, req.requestId) });
  } catch (err) {
    next(err);
  }
});

router.post("/classify", authenticate, requireAuth, validate(DocIdSchema), async (req, res, next) => {
  try {
    res.status(201).json({ job: await AiService.classify(req.user!, req.body.documentId, req.requestId) });
  } catch (err) {
    next(err);
  }
});

router.post("/summarize", authenticate, requireAuth, validate(DocIdSchema), async (req, res, next) => {
  try {
    res.status(201).json({ job: await AiService.summarize(req.user!, req.body.documentId, req.requestId) });
  } catch (err) {
    next(err);
  }
});

router.get("/jobs/:id", authenticate, requireAuth, async (req, res, next) => {
  try {
    res.json({ job: await AiService.jobStatus(req.user!, req.params.id) });
  } catch (err) {
    next(err);
  }
});

export default router;
