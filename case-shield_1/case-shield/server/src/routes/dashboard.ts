import { Router } from "../lib/miniserver";
import { db } from "../db";
import { requireAuth } from "../middleware/auth";
import { authorizedCaseIds } from "../lib/permissions";

const router = Router();
router.use(requireAuth);

router.get("/summary", (req, res) => {
  const scope = authorizedCaseIds(req.user! as any);
  const clause = scope === "ALL" ? "1=1" : scope.length === 0 ? "1=0" : `cases.id IN (${scope.map(() => "?").join(",")})`;
  const params = scope === "ALL" || scope.length === 0 ? [] : scope;

  const activeCases = db.prepare(`SELECT COUNT(*) as c FROM cases WHERE ${clause} AND status NOT IN ('Closed')`).get(...params) as any;
  const docClause = scope === "ALL" ? "1=1" : scope.length === 0 ? "1=0" : `case_id IN (${scope.map(() => "?").join(",")})`;
  const totalDocuments = db.prepare(`SELECT COUNT(*) as c FROM documents WHERE ${docClause}`).get(...params) as any;
  const evidenceItems = db.prepare(`SELECT COUNT(*) as c FROM evidence WHERE ${docClause}`).get(...params) as any;
  const pendingAccessRequests = db
    .prepare(`SELECT COUNT(*) as c FROM access_requests WHERE ${docClause} AND status = 'Pending'`)
    .get(...params) as any;

  const recentCases = db
    .prepare(
      `SELECT cases.id, cases.case_number as caseNumber, cases.title, cases.status, cases.priority, cases.updated_at as updatedAt,
              case_categories.name as category
       FROM cases
       JOIN case_types ON case_types.id = cases.case_type_id
       JOIN case_categories ON case_categories.id = case_types.category_id
       WHERE ${clause} ORDER BY cases.updated_at DESC LIMIT 5`
    )
    .all(...params);

  const recentActivity = db
    .prepare(
      `SELECT id, event_timestamp as timestamp, actor_name as actor, action, resource_type as resourceType, result
       FROM audit_events ORDER BY rowid DESC LIMIT 8`
    )
    .all();

  const pendingRequests = db
    .prepare(
      `SELECT ar.id, ar.resource_label as resourceLabel, ar.permission, ar.status, ar.requested_at as requestedAt,
              req.name as requesterName, c.case_number as caseNumber, ar.case_id as caseId
       FROM access_requests ar JOIN users req ON req.id = ar.requester_id JOIN cases c ON c.id = ar.case_id
       WHERE ${docClause.replace(/case_id/g, "ar.case_id")} AND ar.status = 'Pending' ORDER BY ar.requested_at DESC LIMIT 5`
    )
    .all(...params);

  const integrityViolations = db.prepare(`SELECT COUNT(*) as c FROM audit_events WHERE action = 'Integrity Violation'`).get() as any;

  res.json({
    activeCases: activeCases.c,
    totalDocuments: totalDocuments.c,
    evidenceItems: evidenceItems.c,
    pendingAccessRequests: pendingAccessRequests.c,
    security: {
      authentication: "Protected",
      storage: "Private",
      documentIntegrity: "Monitoring Active",
      auditLogging: "Active",
    },
    recentCases,
    recentActivity,
    pendingRequests,
    securityAlerts:
      integrityViolations.c > 0
        ? [{ level: "warning", message: `${integrityViolations.c} integrity violation(s) recorded in the audit log.` }]
        : [{ level: "info", message: "No integrity violations recorded." }],
  });
});

export default router;
