import { Router } from "../lib/miniserver";
import { db } from "../db";
import { requireAuth } from "../middleware/auth";
import { can } from "../lib/permissions";
import { writeAudit } from "../lib/audit";
import { id, now } from "../lib/ids";

const router = Router();
router.use(requireAuth);

router.get("/case/:caseId", (req, res) => {
  const perm = can(req.user! as any, "view", "evidence", { caseId: req.params.caseId });
  if (!perm.allow) return res.status(403).json({ error: perm.reason });

  const rows = db
    .prepare(
      `SELECT evidence.*, u1.name as collected_by_name, u2.name as custodian_name,
        (SELECT COUNT(*) FROM custody_events WHERE evidence_id = evidence.id) as custody_event_count
       FROM evidence
       LEFT JOIN users u1 ON u1.id = evidence.collected_by
       LEFT JOIN users u2 ON u2.id = evidence.current_custodian_id
       WHERE evidence.case_id = ? ORDER BY evidence.created_at DESC`
    )
    .all(req.params.caseId);
  res.json(rows);
});

router.get("/:id/custody", (req, res) => {
  const ev = db.prepare("SELECT * FROM evidence WHERE id = ?").get(req.params.id) as any;
  if (!ev) return res.status(404).json({ error: "Evidence not found." });
  const perm = can(req.user! as any, "view", "custody", { caseId: ev.case_id });
  if (!perm.allow) return res.status(403).json({ error: perm.reason });

  const events = db
    .prepare(
      `SELECT ce.*, f.name as from_name, t.name as to_name
       FROM custody_events ce
       LEFT JOIN users f ON f.id = ce.from_person_id
       LEFT JOIN users t ON t.id = ce.to_person_id
       WHERE ce.evidence_id = ? ORDER BY ce.event_timestamp ASC`
    )
    .all(req.params.id);

  res.json({ evidence: ev, events });
});

router.post("/", (req, res) => {
  const { caseId, evidenceType, description, collectionDate } = req.body as Record<string, string>;
  const perm = can(req.user! as any, "upload", "evidence", { caseId });
  if (!perm.allow) return res.status(403).json({ error: perm.reason });

  const code = `EV-2026-${Math.floor(Math.random() * 900 + 100)}`;
  const evidenceId = id();
  const timestamp = now();
  db.prepare(
    `INSERT INTO evidence (id, evidence_code, case_id, evidence_type, description, collected_by, collection_date, current_custodian_id, integrity_status, chain_status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Verified', 'In Custody', ?)`
  ).run(evidenceId, code, caseId, evidenceType, description, req.user!.id, collectionDate || timestamp, req.user!.id, timestamp);

  db.prepare(
    `INSERT INTO custody_events (id, evidence_id, from_person_id, to_person_id, from_role, to_role, action, reason, status, event_timestamp)
     VALUES (?, ?, NULL, ?, NULL, ?, 'Collected', 'Initial collection into evidence custody.', 'Completed', ?)`
  ).run(id(), evidenceId, req.user!.id, req.user!.role, timestamp);

  writeAudit({ actor: req.user!, action: "Evidence Collected", resourceType: "evidence", resourceId: evidenceId, caseId, result: "Success", metadata: { evidence_code: code } });

  res.status(201).json({ evidenceId, code });
});

const CUSTODY_ACTIONS = ["Collected", "Transferred", "Received", "Examined", "Verified", "Submitted", "Released", "Archived"];

router.post("/:id/custody", (req, res) => {
  const ev = db.prepare("SELECT * FROM evidence WHERE id = ?").get(req.params.id) as any;
  if (!ev) return res.status(404).json({ error: "Evidence not found." });
  const perm = can(req.user! as any, "upload", "custody", { caseId: ev.case_id });
  if (!perm.allow) return res.status(403).json({ error: perm.reason });

  const { toPersonId, action, reason } = req.body as Record<string, string>;
  if (!CUSTODY_ACTIONS.includes(action)) return res.status(400).json({ error: "Invalid custody action." });

  const toPerson = db.prepare("SELECT id, name, role FROM users WHERE id = ?").get(toPersonId) as any;
  if (!toPerson) return res.status(400).json({ error: "Recipient not found." });

  const timestamp = now();
  db.prepare(
    `INSERT INTO custody_events (id, evidence_id, from_person_id, to_person_id, from_role, to_role, action, reason, status, event_timestamp)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Completed', ?)`
  ).run(id(), ev.id, req.user!.id, toPerson.id, req.user!.role, toPerson.role, action, reason || "", timestamp);

  const newChainStatus = action === "Released" ? "Released" : action === "Archived" ? "Archived" : action === "Transferred" ? "Transferred" : "In Custody";
  db.prepare("UPDATE evidence SET current_custodian_id = ?, chain_status = ? WHERE id = ?").run(toPerson.id, newChainStatus, ev.id);

  writeAudit({
    actor: req.user!,
    action: "Evidence Transferred",
    resourceType: "evidence",
    resourceId: ev.id,
    caseId: ev.case_id,
    result: "Success",
    metadata: { action, to: toPerson.name },
  });

  res.status(201).json({ ok: true });
});

export default router;
