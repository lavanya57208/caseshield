import { Router } from "../lib/miniserver";
import { db } from "../db";
import { requireAuth } from "../middleware/auth";
import { can } from "../lib/permissions";
import { verifyAuditChain } from "../lib/audit";

const router = Router();
router.use(requireAuth);

router.get("/case/:caseId", (req, res) => {
  const perm = can(req.user! as any, "view", "audit", { caseId: req.params.caseId });
  if (!perm.allow) return res.status(403).json({ error: perm.reason });
  const rows = db
    .prepare(
      `SELECT id, event_timestamp as timestamp, actor_name as actor, role, action, resource_type as resourceType, resource_id as resourceId, result, metadata
       FROM audit_events WHERE case_id = ? ORDER BY rowid DESC`
    )
    .all(req.params.caseId);
  res.json(rows.map((r: any) => ({ ...r, metadata: r.metadata ? JSON.parse(r.metadata) : {} })));
});

router.get("/system", (req, res) => {
  const perm = can(req.user! as any, "view", "audit");
  if (!perm.allow) return res.status(403).json({ error: perm.reason });

  const { actor, action, result, from, to, q } = req.query as Record<string, string>;
  let sql = `SELECT ae.id, ae.event_timestamp as timestamp, ae.actor_name as actor, ae.role, ae.action, ae.resource_type as resourceType,
                    ae.resource_id as resourceId, ae.case_id as caseId, c.case_number as caseNumber, ae.result, ae.metadata
             FROM audit_events ae LEFT JOIN cases c ON c.id = ae.case_id WHERE 1=1`;
  const args: any[] = [];
  if (actor) {
    sql += " AND ae.actor_name LIKE ?";
    args.push(`%${actor}%`);
  }
  if (action) {
    sql += " AND ae.action = ?";
    args.push(action);
  }
  if (result) {
    sql += " AND ae.result = ?";
    args.push(result);
  }
  if (from) {
    sql += " AND ae.event_timestamp >= ?";
    args.push(from);
  }
  if (to) {
    sql += " AND ae.event_timestamp <= ?";
    args.push(to);
  }
  if (q) {
    sql += " AND (ae.action LIKE ? OR ae.resource_type LIKE ? OR c.case_number LIKE ?)";
    args.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  sql += " ORDER BY ae.rowid DESC LIMIT 500";

  const rows = db.prepare(sql).all(...args);
  res.json(rows.map((r: any) => ({ ...r, metadata: r.metadata ? JSON.parse(r.metadata) : {} })));
});

router.get("/verify-chain", (req, res) => {
  const perm = can(req.user! as any, "view", "audit");
  if (!perm.allow) return res.status(403).json({ error: perm.reason });
  const result = verifyAuditChain();
  res.json({
    status: result.verified ? "AUDIT CHAIN VERIFIED" : "AUDIT CHAIN INCONSISTENCY DETECTED",
    ...result,
    note: "This confirms every stored audit event still hashes forward consistently with the one before it. It demonstrates tamper-evidence within this application's own database, not physical immutability.",
  });
});

export default router;
