import { Router } from "../lib/miniserver";
import { db } from "../db";
import { requireAuth } from "../middleware/auth";
import { now } from "../lib/ids";

const router = Router();
router.use(requireAuth);

router.get("/", (req, res) => {
  const rows = db.prepare("SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50").all(req.user!.id);
  res.json(rows);
});

router.post("/:id/read", (req, res) => {
  db.prepare("UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?").run(req.params.id, req.user!.id);
  res.json({ ok: true });
});

router.post("/read-all", (req, res) => {
  db.prepare("UPDATE notifications SET is_read = 1 WHERE user_id = ?").run(req.user!.id);
  res.json({ ok: true });
});

export default router;
