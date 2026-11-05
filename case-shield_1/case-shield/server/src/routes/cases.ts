import { Router } from "../lib/miniserver";
import { db } from "../db";
import { requireAuth } from "../middleware/auth";
import { authorizedCaseIds, can } from "../lib/permissions";
import { writeAudit } from "../lib/audit";

const router = Router();
router.use(requireAuth);

function scopeClause(user: { id: string }) {
  const scope = authorizedCaseIds(user as any);
  if (scope === "ALL") return { clause: "1=1", params: [] as string[] };
  if (scope.length === 0) return { clause: "1=0", params: [] as string[] };
  return { clause: `cases.id IN (${scope.map(() => "?").join(",")})`, params: scope };
}

router.get("/", (req, res) => {
  const { clause, params } = scopeClause(req.user!);
  const { q, status, priority, courtId, categoryId, caseTypeId, assignedTo } = req.query as Record<string, string>;

  let sql = `
    SELECT cases.*, case_types.name as case_type_name, case_types.category_id as category_id,
           case_categories.name as category_name, courts.name as court_name, courts.type as court_type,
           u.name as investigator_name,
           (SELECT COUNT(*) FROM documents WHERE documents.case_id = cases.id) as document_count,
           (SELECT COUNT(*) FROM evidence WHERE evidence.case_id = cases.id) as evidence_count
    FROM cases
    JOIN case_types ON case_types.id = cases.case_type_id
    JOIN case_categories ON case_categories.id = case_types.category_id
    JOIN courts ON courts.id = cases.court_id
    LEFT JOIN users u ON u.id = cases.assigned_investigator_id
    WHERE ${clause}
  `;
  const args: any[] = [...params];

  if (q) {
    sql += " AND (cases.title LIKE ? OR cases.case_number LIKE ?)";
    args.push(`%${q}%`, `%${q}%`);
  }
  if (status) {
    sql += " AND cases.status = ?";
    args.push(status);
  }
  if (priority) {
    sql += " AND cases.priority = ?";
    args.push(priority);
  }
  if (courtId) {
    sql += " AND cases.court_id = ?";
    args.push(courtId);
  }
  if (categoryId) {
    sql += " AND case_categories.id = ?";
    args.push(categoryId);
  }
  if (caseTypeId) {
    sql += " AND cases.case_type_id = ?";
    args.push(caseTypeId);
  }
  if (assignedTo) {
    sql += " AND cases.assigned_investigator_id = ?";
    args.push(assignedTo);
  }
  sql += " ORDER BY cases.updated_at DESC";

  const rows = db.prepare(sql).all(...args);
  res.json(rows);
});

router.get("/:id", (req, res) => {
  const { clause, params } = scopeClause(req.user!);
  const row = db
    .prepare(
      `SELECT cases.*, case_types.name as case_type_name, case_categories.name as category_name,
              case_categories.id as category_id, courts.name as court_name, courts.type as court_type,
              u.name as investigator_name, creator.name as created_by_name
       FROM cases
       JOIN case_types ON case_types.id = cases.case_type_id
       JOIN case_categories ON case_categories.id = case_types.category_id
       JOIN courts ON courts.id = cases.court_id
       LEFT JOIN users u ON u.id = cases.assigned_investigator_id
       LEFT JOIN users creator ON creator.id = cases.created_by
       WHERE cases.id = ? AND ${clause}`
    )
    .get(req.params.id, ...params);

  if (!row) return res.status(404).json({ error: "Case not found or you are not authorized to view it." });

  const permission = can(req.user! as any, "view", "case", { caseId: req.params.id });
  if (!permission.allow) return res.status(403).json({ error: permission.reason });

  const stakeholders = db
    .prepare(
      `SELECT u.id, u.name, u.role, u.department, cs.role_in_case as roleInCase
       FROM case_stakeholders cs JOIN users u ON u.id = cs.user_id WHERE cs.case_id = ?`
    )
    .all(req.params.id);

  const documentCount = (db.prepare("SELECT COUNT(*) as c FROM documents WHERE case_id = ?").get(req.params.id) as any).c;
  const evidenceCount = (db.prepare("SELECT COUNT(*) as c FROM evidence WHERE case_id = ?").get(req.params.id) as any).c;
  const pendingRequests = (
    db.prepare("SELECT COUNT(*) as c FROM access_requests WHERE case_id = ? AND status = 'Pending'").get(req.params.id) as any
  ).c;

  writeAudit({
    actor: req.user!,
    action: "Case Viewed",
    resourceType: "case",
    resourceId: req.params.id,
    caseId: req.params.id,
    result: "Success",
  });

  res.json({ ...row, stakeholders, documentCount, evidenceCount, pendingRequests });
});

router.get("/:id/activity", (req, res) => {
  const events = db
    .prepare(
      `SELECT id, event_timestamp as timestamp, actor_name as actor, role, action, resource_type as resourceType, resource_id as resourceId, result
       FROM audit_events WHERE case_id = ? ORDER BY rowid DESC LIMIT 15`
    )
    .all(req.params.id);
  res.json(events);
});

export default router;
