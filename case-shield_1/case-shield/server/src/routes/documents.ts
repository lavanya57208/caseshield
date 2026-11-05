import { Router } from "../lib/miniserver";
import fs from "fs";
import path from "path";
import { db } from "../db";
import { requireAuth } from "../middleware/auth";
import { can } from "../lib/permissions";
import { writeAudit } from "../lib/audit";
import { id, now } from "../lib/ids";
import { sha256Buffer } from "../lib/hash";
import { getAIProvider } from "../ai/provider";

const router = Router();
router.use(requireAuth);

const STORAGE_ROOT = path.join(__dirname, "..", "..", "storage");
const MAX_FILE_BYTES = 25 * 1024 * 1024;

const ALLOWED_TYPES = [
  "FIR / Police Report",
  "Investigation Report",
  "Witness Statement",
  "Charge Sheet",
  "Court Filing",
  "Forensic Report",
  "Legal Notice",
  "Judgment",
  "Evidence Record",
  "Other",
];
const ALLOWED_MIME = new Set([
  "application/pdf",
  "text/plain",
  "image/png",
  "image/jpeg",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

function documentRow(documentId: string) {
  return db
    .prepare(
      `SELECT documents.*, u.name as uploaded_by_name
       FROM documents LEFT JOIN users u ON u.id = documents.uploaded_by WHERE documents.id = ?`
    )
    .get(documentId) as any;
}

/**
 * Uploads in this prototype travel as base64 inside a JSON body rather than
 * multipart/form-data, so the server has zero parsing dependencies. The
 * frontend reads the chosen File with FileReader and posts
 * { filename, mimeType, sizeBytes, dataBase64, ... }.
 */
function decodeUpload(body: any): { buffer: Buffer; filename: string; mimeType: string } | { error: string } {
  const { filename, mimeType, dataBase64 } = body || {};
  if (!filename || !mimeType || !dataBase64) return { error: "File data, filename and MIME type are required." };
  if (!ALLOWED_MIME.has(mimeType)) {
    return { error: `File type ${mimeType} is not permitted. Allowed: PDF, DOC/DOCX, PNG, JPG, TXT.` };
  }
  let buffer: Buffer;
  try {
    buffer = Buffer.from(dataBase64, "base64");
  } catch {
    return { error: "File data could not be decoded." };
  }
  if (buffer.length === 0) return { error: "The uploaded file is empty." };
  if (buffer.length > MAX_FILE_BYTES) return { error: "File exceeds the 25MB upload limit." };
  return { buffer, filename, mimeType };
}

router.get("/case/:caseId", (req, res) => {
  const perm = can(req.user! as any, "view", "case", { caseId: req.params.caseId });
  if (!perm.allow) return res.status(403).json({ error: perm.reason });

  const docs = db
    .prepare(
      `SELECT documents.*, u.name as uploaded_by_name,
        (SELECT COUNT(*) FROM document_versions WHERE document_id = documents.id) as version_count
       FROM documents LEFT JOIN users u ON u.id = documents.uploaded_by
       WHERE documents.case_id = ? ORDER BY documents.updated_at DESC`
    )
    .all(req.params.caseId) as any[];

  // Filter by per-document view authorization (restricted docs need explicit grant)
  const visible = docs.filter((d) => can(req.user! as any, "view", "document", { caseId: req.params.caseId, documentId: d.id }).allow);
  res.json(visible.map((d) => ({ ...d, tags: d.tags ? d.tags.split(",") : [] })));
});

router.get("/:id", (req, res) => {
  const doc = documentRow(req.params.id);
  if (!doc) return res.status(404).json({ error: "Document not found." });
  const perm = can(req.user! as any, "view", "document", { caseId: doc.case_id, documentId: doc.id });
  if (!perm.allow) return res.status(403).json({ error: perm.reason });

  const versions = db
    .prepare(
      `SELECT dv.*, u.name as uploaded_by_name FROM document_versions dv LEFT JOIN users u ON u.id = dv.uploaded_by
       WHERE dv.document_id = ? ORDER BY dv.version_number DESC`
    )
    .all(req.params.id);
  const signatures = db.prepare("SELECT * FROM document_signatures WHERE document_id = ?").all(req.params.id);

  writeAudit({ actor: req.user!, action: "Document Viewed", resourceType: "document", resourceId: doc.id, caseId: doc.case_id, result: "Success" });

  res.json({ ...doc, tags: doc.tags ? doc.tags.split(",") : [], versions, signatures });
});

router.post("/upload", (req, res) => {
  const { caseId, documentType, description, confidentiality, tags } = (req.body || {}) as Record<string, string>;

  const perm = can(req.user! as any, "upload", "document", { caseId });
  if (!perm.allow) {
    writeAudit({ actor: req.user!, action: "Document Uploaded", resourceType: "document", caseId, result: "Denied", metadata: { reason: perm.reason } });
    return res.status(403).json({ error: perm.reason });
  }

  const decoded = decodeUpload(req.body);
  if ("error" in decoded) return res.status(400).json({ error: decoded.error });
  if (!ALLOWED_TYPES.includes(documentType)) return res.status(400).json({ error: "Unsupported document type." });
  if (!["Restricted", "Confidential", "Internal", "Case Team Only"].includes(confidentiality)) {
    return res.status(400).json({ error: "Invalid confidentiality level." });
  }

  const caseRow = db.prepare("SELECT id FROM cases WHERE id = ?").get(caseId);
  if (!caseRow) return res.status(404).json({ error: "Case not found." });

  const documentId = id();
  const { buffer, filename, mimeType } = decoded;
  const dir = path.join(STORAGE_ROOT, caseId, documentId);
  fs.mkdirSync(dir, { recursive: true });
  const storedName = `v1__${filename}`;
  const fullPath = path.join(dir, storedName);
  fs.writeFileSync(fullPath, buffer);
  const hash = sha256Buffer(buffer);
  const timestamp = now();
  const documentNumber = `DOC-2026-${Math.floor(Math.random() * 90000 + 10000)}`;

  db.prepare(
    `INSERT INTO documents (id, case_id, document_number, filename, document_type, description, confidentiality_level, access_level, tags, current_version, status, uploaded_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'Active', ?, ?, ?)`
  ).run(documentId, caseId, documentNumber, filename, documentType, description || "", confidentiality, confidentiality, tags || "", req.user!.id, timestamp, timestamp);

  const versionId = id();
  db.prepare(
    `INSERT INTO document_versions (id, document_id, version_number, previous_version_id, storage_path, original_filename, mime_type, size_bytes, sha256_hash, uploaded_by, change_description, created_at)
     VALUES (?, ?, 1, NULL, ?, ?, ?, ?, ?, ?, 'Initial upload', ?)`
  ).run(versionId, documentId, path.relative(STORAGE_ROOT, fullPath), filename, mimeType, buffer.length, hash, req.user!.id, timestamp);

  db.prepare(
    `INSERT INTO document_signatures (id, document_id, version_id, signer_id, status, signed_at, document_hash, verification_status) VALUES (?, ?, ?, NULL, 'Integration Ready', NULL, ?, 'Not Applicable')`
  ).run(id(), documentId, versionId, hash);

  writeAudit({
    actor: req.user!,
    action: "Document Uploaded",
    resourceType: "document",
    resourceId: documentId,
    caseId,
    result: "Success",
    metadata: { document_number: documentNumber, filename, sha256_hash: hash },
  });

  res.status(201).json({
    documentId,
    documentNumber,
    sha256Hash: hash,
    message: "Document uploaded. Integrity hash registered and audit record created.",
  });
});

router.post("/:id/versions", (req, res) => {
  const doc = documentRow(req.params.id);
  if (!doc) return res.status(404).json({ error: "Document not found." });
  const perm = can(req.user! as any, "edit_metadata", "document", { caseId: doc.case_id, documentId: doc.id });
  if (!perm.allow) return res.status(403).json({ error: perm.reason });

  const decoded = decodeUpload(req.body);
  if ("error" in decoded) return res.status(400).json({ error: decoded.error });
  const { changeDescription } = (req.body || {}) as Record<string, string>;
  const { buffer, filename, mimeType } = decoded;

  const newVersionNumber = doc.current_version + 1;
  const dir = path.join(STORAGE_ROOT, doc.case_id, doc.id);
  fs.mkdirSync(dir, { recursive: true });
  const storedName = `v${newVersionNumber}__${filename}`;
  const fullPath = path.join(dir, storedName);
  fs.writeFileSync(fullPath, buffer);
  const hash = sha256Buffer(buffer);
  const timestamp = now();

  const prevVersion = db
    .prepare("SELECT id FROM document_versions WHERE document_id = ? AND version_number = ?")
    .get(doc.id, doc.current_version) as { id: string };

  const versionId = id();
  db.prepare(
    `INSERT INTO document_versions (id, document_id, version_number, previous_version_id, storage_path, original_filename, mime_type, size_bytes, sha256_hash, uploaded_by, change_description, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(versionId, doc.id, newVersionNumber, prevVersion?.id ?? null, path.relative(STORAGE_ROOT, fullPath), filename, mimeType, buffer.length, hash, req.user!.id, changeDescription || "", timestamp);

  db.prepare("UPDATE documents SET current_version = ?, updated_at = ? WHERE id = ?").run(newVersionNumber, timestamp, doc.id);

  writeAudit({
    actor: req.user!,
    action: "Document Version Created",
    resourceType: "document",
    resourceId: doc.id,
    caseId: doc.case_id,
    result: "Success",
    metadata: { version: newVersionNumber, sha256_hash: hash },
  });

  res.status(201).json({ versionId, versionNumber: newVersionNumber, sha256Hash: hash });
});

router.get("/:id/download", (req, res) => {
  const doc = documentRow(req.params.id);
  if (!doc) return res.status(404).json({ error: "Document not found." });
  const perm = can(req.user! as any, "download", "document", { caseId: doc.case_id, documentId: doc.id });
  if (!perm.allow) {
    writeAudit({ actor: req.user!, action: "Document Downloaded", resourceType: "document", resourceId: doc.id, caseId: doc.case_id, result: "Denied", metadata: { reason: perm.reason } });
    return res.status(403).json({ error: perm.reason });
  }

  const version = db
    .prepare("SELECT * FROM document_versions WHERE document_id = ? AND version_number = ?")
    .get(doc.id, req.query.version ? Number(req.query.version) : doc.current_version) as any;
  if (!version) return res.status(404).json({ error: "Version not found." });

  const fullPath = path.join(STORAGE_ROOT, version.storage_path);
  if (!fs.existsSync(fullPath)) return res.status(404).json({ error: "Stored file is missing from private storage." });

  writeAudit({
    actor: req.user!,
    action: "Document Downloaded",
    resourceType: "document",
    resourceId: doc.id,
    caseId: doc.case_id,
    result: "Success",
    metadata: { version: version.version_number },
  });

  res.download(fullPath, version.original_filename);
});

router.post("/:id/verify-integrity", (req, res) => {
  const doc = documentRow(req.params.id);
  if (!doc) return res.status(404).json({ error: "Document not found." });
  const perm = can(req.user! as any, "verify_integrity", "document", { caseId: doc.case_id, documentId: doc.id });
  if (!perm.allow) return res.status(403).json({ error: perm.reason });

  const versionNumber = req.query.version ? Number(req.query.version) : doc.current_version;
  const version = db.prepare("SELECT * FROM document_versions WHERE document_id = ? AND version_number = ?").get(doc.id, versionNumber) as any;
  if (!version) return res.status(404).json({ error: "Version not found." });

  const fullPath = path.join(STORAGE_ROOT, version.storage_path);
  let currentHash: string | null = null;
  let result: "INTEGRITY VERIFIED" | "INTEGRITY VIOLATION" | "FILE MISSING" = "FILE MISSING";
  if (fs.existsSync(fullPath)) {
    currentHash = sha256Buffer(fs.readFileSync(fullPath));
    result = currentHash === version.sha256_hash ? "INTEGRITY VERIFIED" : "INTEGRITY VIOLATION";
  }

  writeAudit({
    actor: req.user!,
    action: result === "INTEGRITY VERIFIED" ? "Integrity Verified" : "Integrity Violation",
    resourceType: "document",
    resourceId: doc.id,
    caseId: doc.case_id,
    result: result === "INTEGRITY VERIFIED" ? "Success" : "Failure",
    metadata: { version: versionNumber, registeredHash: version.sha256_hash, currentHash },
  });

  res.json({
    result,
    registeredHash: version.sha256_hash,
    currentHash,
    verifiedAt: now(),
    verifiedBy: req.user!.name,
    note: "SHA-256 comparison detects whether the current file content differs from the content registered at upload time. It does not, by itself, prevent tampering or establish legal admissibility.",
  });
});

router.patch("/:id/metadata", (req, res) => {
  const doc = documentRow(req.params.id);
  if (!doc) return res.status(404).json({ error: "Document not found." });
  const perm = can(req.user! as any, "edit_metadata", "document", { caseId: doc.case_id, documentId: doc.id });
  if (!perm.allow) return res.status(403).json({ error: perm.reason });

  const { description, tags, confidentiality } = (req.body || {}) as Record<string, string>;
  const timestamp = now();
  db.prepare(
    `UPDATE documents SET description = COALESCE(?, description), tags = COALESCE(?, tags), confidentiality_level = COALESCE(?, confidentiality_level), access_level = COALESCE(?, access_level), updated_at = ? WHERE id = ?`
  ).run(description ?? null, tags ?? null, confidentiality ?? null, confidentiality ?? null, timestamp, doc.id);

  writeAudit({ actor: req.user!, action: "Permission Changed", resourceType: "document", resourceId: doc.id, caseId: doc.case_id, result: "Success", metadata: { field: "metadata" } });
  res.json({ ok: true });
});

// --- AI Document Intelligence (authorization-aware; honest when unconfigured) ----
router.get("/:id/ai-summary", async (req, res) => {
  const doc = documentRow(req.params.id);
  if (!doc) return res.status(404).json({ error: "Document not found." });
  const perm = can(req.user! as any, "view", "document", { caseId: doc.case_id, documentId: doc.id });
  if (!perm.allow) return res.status(403).json({ error: perm.reason });

  const provider = getAIProvider();
  const [classification, metadata, summary, similar] = await Promise.all([
    provider.classify(doc.description || doc.filename),
    provider.extractMetadata(doc.description || doc.filename),
    provider.summarize(doc.description || doc.filename),
    provider.findSimilar(doc.id),
  ]);

  res.json({ provider: provider.name, classification, metadata, summary, similar });
});

router.get("/meta/document-types", (_req, res) => res.json(ALLOWED_TYPES));

export default router;
