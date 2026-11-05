import { Router } from "express";
import { authenticate, requireAuth } from "@/middleware/auth";
import { requirePermission } from "@/middleware/authorize";
import { validate } from "@/middleware/validate";
import { PERMISSIONS } from "@/lib/permissions";
import { CasesService } from "@/modules/cases/cases.service";
import {
  CreateCaseSchema,
  UpdateCaseSchema,
  AssignCaseSchema,
  ListCasesQuerySchema,
} from "@/modules/cases/cases.schemas";

const router = Router();

router.get("/categories", authenticate, requireAuth, async (_req, res, next) => {
  try {
    res.json({ categories: await CasesService.listCategories() });
  } catch (err) {
    next(err);
  }
});

router.get("/next-number", authenticate, requireAuth, requirePermission(PERMISSIONS.CASE_CREATE), async (_req, res, next) => {
  try {
    res.json({ caseNumber: await CasesService.suggestCaseNumber() });
  } catch (err) {
    next(err);
  }
});

// Investigating-officer picker for the create / edit case forms.
router.get("/officers", authenticate, requireAuth, requirePermission(PERMISSIONS.CASE_CREATE), async (req, res, next) => {
  try {
    res.json({ officers: await CasesService.assignableOfficers(req.user!) });
  } catch (err) {
    next(err);
  }
});

router.get("/", authenticate, requireAuth, validate(ListCasesQuerySchema, "query"), async (req, res, next) => {
  try {
    const result = await CasesService.list(req.user!, req.query as any);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post(
  "/",
  authenticate,
  requireAuth,
  requirePermission(PERMISSIONS.CASE_CREATE),
  validate(CreateCaseSchema),
  async (req, res, next) => {
    try {
      const created = await CasesService.create(req.user!, req.body, req.requestId);
      res.status(201).json({ case: created });
    } catch (err) {
      next(err);
    }
  },
);

router.get("/:id", authenticate, requireAuth, async (req, res, next) => {
  try {
    const c = await CasesService.getById(req.user!, req.params.id, req.requestId);
    res.json({ case: c });
  } catch (err) {
    next(err);
  }
});

router.patch("/:id", authenticate, requireAuth, validate(UpdateCaseSchema), async (req, res, next) => {
  try {
    const updated = await CasesService.update(req.user!, req.params.id, req.body, req.requestId);
    res.json({ case: updated });
  } catch (err) {
    next(err);
  }
});

router.post("/:id/assign", authenticate, requireAuth, validate(AssignCaseSchema), async (req, res, next) => {
  try {
    const assignment = await CasesService.assign(req.user!, req.params.id, req.body, req.requestId);
    res.status(201).json({ assignment });
  } catch (err) {
    next(err);
  }
});

router.get("/:id/activity", authenticate, requireAuth, async (req, res, next) => {
  try {
    const events = await CasesService.activity(req.user!, req.params.id);
    res.json({ events });
  } catch (err) {
    next(err);
  }
});

export default router;
