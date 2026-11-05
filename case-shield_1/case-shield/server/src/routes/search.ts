import { Router } from "../lib/miniserver";
import { db } from "../db";
import { requireAuth } from "../middleware/auth";
import { authorizedCaseIds, can } from "../lib/permissions";

const router = Router();
router.use(requireAuth);

router.get("/", (req, res) => {
  const q = ((req.query.q as string) || "").trim();
  if (!q) return res.json({ cases: [], documents: [], evidence: [] });

  const scope = authorizedCaseIds(req.user! as any);
  const scopeClause = scope === "ALL" ? "1=1" : scope.length === 0 ? "1=0" : `case_id IN (${scope.map(() => "?").join(",")})`;
  const scopeCaseClause = scope === "ALL" ? "1=1" : scope.length === 0 ? "1=0" : `cases.id IN (${scope.map(() => "?").join(",")})`;
  const scopeParams = scope === "ALL" || scope.length === 0 ? [] : scope;

  const cases = db
    .prepare(
      `SELECT cases.id, cases.case_number as caseNumber, cases.title, cases.status, cases.priority, cases.updated_at as updatedAt,
              case_categories.name as category
       FROM cases
       JOIN case_types ON case_types.id = cases.case_type_id
       JOIN case_categories ON case_categories.id = case_types.category_id
       WHERE ${scopeCaseClause} AND (cases.title LIKE ? OR cases.case_number LIKE ?)
       LIMIT 25`
    )
    .all(...scopeParams, `%${q}%`, `%${q}%`);

  const documentsRaw = db
    .prepare(
      `SELECT documents.id, documents.document_number as documentNumber, documents.filename, documents.document_type as documentType,
              documents.confidentiality_level as confidentialityLevel, documents.case_id as caseId, documents.updated_at as updatedAt,
              cases.case_number as caseNumber, cases.title as caseTitle
       FROM documents JOIN cases ON cases.id = documents.case_id
       WHERE ${scopeClause} AND (documents.filename LIKE ? OR documents.document_number LIKE ? OR documents.document_type LIKE ?)
       LIMIT 50`
    )
    .all(...scopeParams, `%${q}%`, `%${q}%`, `%${q}%`) as any[];

  // A user must never receive search results for documents they are not authorized to access.
  const documents = documentsRaw.filter((d) => can(req.user! as any, "view", "document", { caseId: d.caseId, documentId: d.id }).allow);

  const evidence = db
    .prepare(
      `SELECT evidence.id, evidence.evidence_code as evidenceCode, evidence.evidence_type as evidenceType, evidence.description,
              evidence.case_id as caseId, evidence.integrity_status as integrityStatus, cases.case_number as caseNumber
       FROM evidence JOIN cases ON cases.id = evidence.case_id
       WHERE ${scopeClause} AND (evidence.evidence_code LIKE ? OR evidence.evidence_type LIKE ? OR evidence.description LIKE ?)
       LIMIT 25`
    )
    .all(...scopeParams, `%${q}%`, `%${q}%`, `%${q}%`);

  res.json({ cases, documents, evidence });
});

export default router;
