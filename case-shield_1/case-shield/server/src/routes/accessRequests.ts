import { Router } from "../lib/miniserver";
import { db } from "../db";
import { requireAuth } from "../middleware/auth";
import { can } from "../lib/permissions";
import { writeAudit } from "../lib/audit";
import { id, now } from "../lib/ids";

const router = Router();
router.use(requireAuth);

router.get("/case/:caseId", (req, res) => {
  const perm = can(req.user! as any, "view", "access_request", { caseId: req.params.caseId });
  if (!perm.allow) return res.status(403).json({ error: perm.reason });

  const rows = db
    .prepare(
      `SELECT ar.*, req.name as requester_name, rev.name as reviewer_name
       FROM access_requests ar
       LEFT JOIN users req ON req.id = ar.requester_id
       LEFT JOIN users rev ON rev.id = ar.reviewer_id
       WHERE ar.case_id = ? ORDER BY ar.requested_at DESC`
    )
    .all(req.params.caseId);
  res.json(rows);
});

router.post("/", (req, res) => {
  const { caseId, resourceType, resourceId, resourceLabel, permission, reason, expiryDays } = req.body as Record<string, string>;
  const perm = can(req.user! as any, "create", "access_request", { caseId });
  if (!perm.allow) return res.status(403).json({ error: perm.reason });

  const reqId = id();
  const requestedAt = now();
  const expiry = expiryDays ? new Date(Date.now() + Number(expiryDays) * 86400000).toISOString() : null;

  db.prepare(
    `INSERT INTO access_requests (id, case_id, requester_id, role, resource_type, resource_id, resource_label, permission, reason, requested_at, expiry, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending')`
  ).run(reqId, caseId, req.user!.id, req.user!.role, resourceType, resourceId || null, resourceLabel, permission, reason, requestedAt, expiry);

  writeAudit({ actor: req.user!, action: "Access Requested", resourceType: "access_request", resourceId: reqId, caseId, result: "Success", metadata: { resourceLabel, permission } });

  res.status(201).json({ id: reqId });
});

function loadRequest(reqId: string) {
  return db.prepare("SELECT * FROM access_requests WHERE id = ?").get(reqId) as any;
}

router.post("/:id/approve", (req, res) => {
  const ar = loadRequest(req.params.id);
  if (!ar) return res.status(404).json({ error: "Access request not found." });
  const perm = can(req.user! as any, "approve", "access_request", { caseId: ar.case_id });
  if (!perm.allow) return res.status(403).json({ error: perm.reason });
  if (ar.status !== "Pending") return res.status(400).json({ error: `Request is already ${ar.status}.` });

  const reviewedAt = now();
  db.prepare("UPDATE access_requests SET status = 'Approved', reviewer_id = ?, reviewed_at = ? WHERE id = ?").run(req.user!.id, reviewedAt, ar.id);

  if (ar.resource_type === "document" && ar.resource_id) {
    db.prepare(
      `INSERT INTO document_permissions (id, document_id, user_id, permission, granted_by, granted_at, expires_at, source_access_request_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id(), ar.resource_id, ar.requester_id, ar.permission, req.user!.id, reviewedAt, ar.expiry, ar.id);
  }

  writeAudit({ actor: req.user!, action: "Access Approved", resourceType: "access_request", resourceId: ar.id, caseId: ar.case_id, result: "Success", metadata: { requester_id: ar.requester_id } });

  const requester = db.prepare("SELECT id FROM users WHERE id = ?").get(ar.requester_id) as any;
  if (requester) {
    db.prepare("INSERT INTO notifications (id, user_id, type, message, link, is_read, created_at) VALUES (?, ?, 'access_request', ?, ?, 0, ?)").run(
      id(),
      requester.id,
      `Your access request for "${ar.resource_label}" was approved.`,
      `/cases/${ar.case_id}/access-requests`,
      now()
    );
  }

  res.json({ ok: true });
});

router.post("/:id/reject", (req, res) => {
  const ar = loadRequest(req.params.id);
  if (!ar) return res.status(404).json({ error: "Access request not found." });
  const perm = can(req.user! as any, "approve", "access_request", { caseId: ar.case_id });
  if (!perm.allow) return res.status(403).json({ error: perm.reason });
  if (ar.status !== "Pending") return res.status(400).json({ error: `Request is already ${ar.status}.` });

  db.prepare("UPDATE access_requests SET status = 'Rejected', reviewer_id = ?, reviewed_at = ? WHERE id = ?").run(req.user!.id, now(), ar.id);
  writeAudit({ actor: req.user!, action: "Access Rejected", resourceType: "access_request", resourceId: ar.id, caseId: ar.case_id, result: "Denied", metadata: { requester_id: ar.requester_id } });
  res.json({ ok: true });
});

router.post("/:id/revoke", (req, res) => {
  const ar = loadRequest(req.params.id);
  if (!ar) return res.status(404).json({ error: "Access request not found." });
  const perm = can(req.user! as any, "revoke", "access_request", { caseId: ar.case_id });
  if (!perm.allow) return res.status(403).json({ error: perm.reason });
  if (ar.status !== "Approved") return res.status(400).json({ error: "Only approved requests can be revoked." });

  db.prepare("UPDATE access_requests SET status = 'Revoked', reviewer_id = ?, reviewed_at = ? WHERE id = ?").run(req.user!.id, now(), ar.id);
  db.prepare("DELETE FROM document_permissions WHERE source_access_request_id = ?").run(ar.id);
  writeAudit({ actor: req.user!, action: "Access Revoked", resourceType: "access_request", resourceId: ar.id, caseId: ar.case_id, result: "Success", metadata: { requester_id: ar.requester_id } });
  res.json({ ok: true });
});

export default router;
