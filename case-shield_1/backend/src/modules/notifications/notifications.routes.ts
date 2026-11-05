import { Router } from "express";
import { authenticate, requireAuth } from "@/middleware/auth";
import { NotificationsService } from "@/modules/notifications/notifications.service";

const router = Router();

router.get("/", authenticate, requireAuth, async (req, res, next) => {
  try {
    const notifications = await NotificationsService.listForUser(req.user!.id);
    res.json({ notifications });
  } catch (err) {
    next(err);
  }
});

router.post("/:id/read", authenticate, requireAuth, async (req, res, next) => {
  try {
    await NotificationsService.markRead(req.user!.id, req.params.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

router.post("/read-all", authenticate, requireAuth, async (req, res, next) => {
  try {
    await NotificationsService.markAllRead(req.user!.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
