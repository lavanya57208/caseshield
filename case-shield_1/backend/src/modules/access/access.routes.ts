import { Router } from "express";
import { authenticate, requireAuth } from "@/middleware/auth";
import { validate } from "@/middleware/validate";
import { AccessService } from "@/modules/access/access.service";
import { CreateAccessRequestSchema, ReviewAccessRequestSchema, ListAccessRequestsQuerySchema } from "@/modules/access/access.schemas";

const router = Router();

router.get("/", authenticate, requireAuth, validate(ListAccessRequestsQuerySchema, "query"), async (req, res, next) => {
  try {
    res.json(await AccessService.list(req.user!, req.query as any));
  } catch (err) {
    next(err);
  }
});

router.post("/", authenticate, requireAuth, validate(CreateAccessRequestSchema), async (req, res, next) => {
  try {
    res.status(201).json({ request: await AccessService.create(req.user!, req.body, req.requestId) });
  } catch (err) {
    next(err);
  }
});

router.post("/:id/approve", authenticate, requireAuth, validate(ReviewAccessRequestSchema), async (req, res, next) => {
  try {
    res.json({ request: await AccessService.approve(req.user!, req.params.id, req.body.reviewNote, req.requestId) });
  } catch (err) {
    next(err);
  }
});

router.post("/:id/reject", authenticate, requireAuth, validate(ReviewAccessRequestSchema), async (req, res, next) => {
  try {
    res.json({ request: await AccessService.reject(req.user!, req.params.id, req.body.reviewNote, req.requestId) });
  } catch (err) {
    next(err);
  }
});

router.post("/:id/revoke", authenticate, requireAuth, async (req, res, next) => {
  try {
    res.json(await AccessService.revoke(req.user!, req.params.id, req.requestId));
  } catch (err) {
    next(err);
  }
});

export default router;
