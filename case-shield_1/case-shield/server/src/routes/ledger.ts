import { Router } from "../lib/miniserver";
import { db } from "../db";
import { requireAuth } from "../middleware/auth";
import { can } from "../lib/permissions";
import { id, now } from "../lib/ids";

/**
 * Optional Local Integrity Ledger
 * ---------------------------------------------------------------------------
 * This is a demonstration of how document/audit hashes COULD be anchored to
 * an external immutable ledger. It is a local, off-chain table - not a
 * connection to any public blockchain. The main application works fully
 * without it; this is an additional, optional provenance layer, not the
 * only integrity mechanism.
 */
const router = Router();
router.use(requireAuth);

router.get("/", (req, res) => {
  const perm = can(req.user! as any, "view", "audit");
  if (!perm.allow) return res.status(403).json({ error: perm.reason });
  const rows = db.prepare("SELECT * FROM integrity_ledger ORDER BY anchored_at DESC LIMIT 100").all();
  res.json(rows);
});

router.post("/anchor", (req, res) => {
  const { anchorType, referenceId, hashValue } = req.body as Record<string, string>;
  const perm = can(req.user! as any, "verify_integrity", "document");
  if (!perm.allow && req.user!.role !== "System Administrator") {
    return res.status(403).json({ error: "Not authorized to anchor integrity records." });
  }
  const entryId = id();
  db.prepare(
    `INSERT INTO integrity_ledger (id, anchor_type, reference_id, hash_value, anchored_at, note) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(entryId, anchorType, referenceId, hashValue, now(), "Local demonstration ledger - not a public blockchain");
  res.status(201).json({ id: entryId });
});

export default router;
