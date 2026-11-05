import { Router } from "../lib/miniserver";
import { db } from "../db";
import { requireAuth } from "../middleware/auth";

const router = Router();
router.use(requireAuth);

router.get("/categories", (_req, res) => {
  const categories = db.prepare("SELECT id, name, description, sort_order as sortOrder FROM case_categories ORDER BY sort_order").all();
  const types = db.prepare("SELECT id, category_id as categoryId, name FROM case_types").all();
  res.json({ categories, types });
});

router.get("/courts", (_req, res) => {
  res.json(db.prepare("SELECT id, name, type FROM courts ORDER BY name").all());
});

router.get("/roles", (_req, res) => {
  res.json([
    "Investigator",
    "Senior Investigator",
    "Forensic Officer",
    "Prosecutor",
    "Judge",
    "Lawyer",
    "Court Staff",
    "Litigant",
    "System Administrator",
    "Auditor",
  ]);
});

export default router;
