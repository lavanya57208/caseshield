import { Router } from "express";
import { authenticate, requireAuth } from "@/middleware/auth";
import { validate } from "@/middleware/validate";
import { SharingService } from "@/modules/sharing/sharing.service";
import { sendFile } from "@/modules/privacy/privacy.routes";
import {
  CreateShareSchema,
  ListSharesQuerySchema,
  RecipientsQuerySchema,
  ReviewShareSchema,
  ShareIdParamsSchema,
} from "@/modules/sharing/sharing.schemas";

const router = Router();

router.get("/recipients", authenticate, requireAuth, validate(RecipientsQuerySchema, "query"), async (req, res, next) => {
  try {
    res.json({ recipients: await SharingService.eligibleRecipients(req.user!, (req.query as any).documentId) });
  } catch (err) {
    next(err);
  }
});

router.get("/", authenticate, requireAuth, validate(ListSharesQuerySchema, "query"), async (req, res, next) => {
  try {
    res.json({ shares: await SharingService.list(req.user!, req.query as any, req.requestId) });
  } catch (err) {
    next(err);
  }
});

router.post("/", authenticate, requireAuth, validate(CreateShareSchema), async (req, res, next) => {
  try {
    res.status(201).json(await SharingService.create(req.user!, req.body, req.requestId));
  } catch (err) {
    next(err);
  }
});

router.get("/:id", authenticate, requireAuth, validate(ShareIdParamsSchema, "params"), async (req, res, next) => {
  try {
    res.json({ share: await SharingService.get(req.user!, req.params.id, req.requestId) });
  } catch (err) {
    next(err);
  }
});

for (const action of ["approve", "reject", "revoke"] as const) {
  router.post(
    `/:id/${action}`,
    authenticate,
    requireAuth,
    validate(ShareIdParamsSchema, "params"),
    validate(ReviewShareSchema),
    async (req, res, next) => {
      try {
        res.json({ share: await SharingService[action](req.user!, req.params.id, req.body.note, req.requestId) });
      } catch (err) {
        next(err);
      }
    },
  );
}

// Content endpoints. Both re-evaluate the share policy server-side on
// every request; "view" serves inline, "download" as an attachment and is
// rejected outright when the share does not allow downloads.
router.get("/:id/view", authenticate, requireAuth, validate(ShareIdParamsSchema, "params"), async (req, res, next) => {
  try {
    sendFile(res, await SharingService.deliver(req.user!, req.params.id, "view", req.requestId), "inline");
  } catch (err) {
    next(err);
  }
});

router.get("/:id/download", authenticate, requireAuth, validate(ShareIdParamsSchema, "params"), async (req, res, next) => {
  try {
    sendFile(res, await SharingService.deliver(req.user!, req.params.id, "download", req.requestId), "attachment");
  } catch (err) {
    next(err);
  }
});

export default router;
