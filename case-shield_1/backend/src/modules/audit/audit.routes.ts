import { Router } from "express";
import { z } from "zod";
import { authenticate, requireAuth } from "@/middleware/auth";
import { validate } from "@/middleware/validate";
import { AuditService } from "@/modules/audit/audit.service";

const router = Router();

// No role-level gate here on purpose: AuditService resolves, per case,
// whether the user holds audit.view (role baseline OR a case-level grant)
// and restricts every query to those cases. See AuditService.scopeFor().

const QuerySchema = z
  .object({
    caseId: z.string().uuid().optional(),
    evidenceId: z.string().uuid().optional(),
    documentId: z.string().uuid().optional(),
    actorId: z.string().uuid().optional(),
    organizationId: z.string().uuid().optional(),
    action: z
      .string()
      .trim()
      .max(64)
      .regex(/^[A-Z0-9_]*$/, "Action must be an audit action code.")
      .optional()
      .transform((v) => (v ? v : undefined)),
    result: z.enum(["SUCCESS", "DENIED", "ERROR"]).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: "'from' must be before 'to'.", path: ["from"] });

const FacetsSchema = z.object({ caseId: z.string().uuid().optional() });

router.get("/", authenticate, requireAuth, validate(QuerySchema, "query"), async (req, res, next) => {
  try {
    const { page, pageSize, ...filters } = req.query as unknown as z.infer<typeof QuerySchema>;
    res.json(await AuditService.list(req.user!, filters, page, pageSize, req.requestId));
  } catch (err) {
    next(err);
  }
});

router.get("/facets", authenticate, requireAuth, validate(FacetsSchema, "query"), async (req, res, next) => {
  try {
    res.json(await AuditService.facets(req.user!, (req.query as any).caseId));
  } catch (err) {
    next(err);
  }
});

export default router;
