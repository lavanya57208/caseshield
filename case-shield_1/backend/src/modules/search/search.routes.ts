import { Router } from "express";
import { z } from "zod";
import { authenticate, requireAuth } from "@/middleware/auth";
import { validate } from "@/middleware/validate";
import { ApiError } from "@/lib/errors";
import { SearchService } from "@/modules/search/search.service";
import { DocumentSearchService } from "@/modules/search/document-search.service";

const router = Router();

const QuerySchema = z.object({
  q: z.string().min(1),
  type: z.enum(["case", "document", "evidence"]).optional(),
});

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use yyyy-mm-dd");
const DocumentSearchSchema = z.object({
  q: z.string().trim().max(500).default(""),
  mode: z.enum(["keyword", "intelligent"]).default("keyword"),
  caseId: z.string().uuid().optional(),
  documentType: z.string().regex(/^[A-Z_]{2,40}$/).optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

// Phase 4 — authorization-aware full-text + intelligent document search.
// A query with no text is allowed only when at least one filter narrows it.
router.get("/documents", authenticate, requireAuth, validate(DocumentSearchSchema, "query"), async (req, res, next) => {
  try {
    const q = req.query as unknown as z.infer<typeof DocumentSearchSchema>;
    if (!q.q && !q.caseId && !q.documentType && !q.dateFrom && !q.dateTo) {
      return next(ApiError.badRequest("VALIDATION_ERROR", "Provide a search query or at least one filter."));
    }
    res.json(await DocumentSearchService.search(req.user!, q, req.requestId));
  } catch (err) {
    next(err);
  }
});

router.get("/", authenticate, requireAuth, validate(QuerySchema, "query"), async (req, res, next) => {
  try {
    const q = req.query as unknown as z.infer<typeof QuerySchema>;
    res.json({ results: await SearchService.search(req.user!, q.q, q.type) });
  } catch (err) {
    next(err);
  }
});

export default router;
