import { Router } from "express";
import { authenticate, requireAuth } from "@/middleware/auth";
import { requirePermission } from "@/middleware/authorize";
import { PERMISSIONS } from "@/lib/permissions";
import { SecurityService } from "@/modules/security/security.service";

const router = Router();

router.get("/events", authenticate, requireAuth, requirePermission(PERMISSIONS.AUDIT_VIEW), async (_req, res, next) => {
  try {
    const events = await SecurityService.list();
    res.json({ events });
  } catch (err) {
    next(err);
  }
});

export default router;
