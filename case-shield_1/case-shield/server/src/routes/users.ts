import { Router } from "../lib/miniserver";
import { db } from "../db";
import { requireAuth } from "../middleware/auth";
import { can } from "../lib/permissions";

const router = Router();
router.use(requireAuth);

router.get("/directory", (req, res) => {
  // Used to populate "transfer custody to" / "grant access to" pickers.
  const rows = db.prepare("SELECT id, name, role, department FROM users WHERE is_active = 1 ORDER BY name").all();
  res.json(rows);
});

router.get("/admin/all", (req, res) => {
  const perm = can(req.user! as any, "manage", "system");
  if (!perm.allow) return res.status(403).json({ error: perm.reason });
  const rows = db.prepare("SELECT id, employee_id as employeeId, name, email, role, department, is_active as isActive, last_login_at as lastLoginAt FROM users ORDER BY name").all();
  res.json(rows);
});

export default router;
