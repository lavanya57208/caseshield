/* eslint-disable no-console */
import fs from "fs";
import path from "path";
import { hashPassword } from "../lib/password";
import { db, initSchema, isSeeded } from "./index";
import { id, now } from "../lib/ids";
import { sha256Buffer } from "../lib/hash";
import { writeAudit } from "../lib/audit";
import { ROLE_PERMISSIONS } from "./rolePermissions";
import { Role } from "../lib/permissions";

const STORAGE_ROOT = path.join(__dirname, "..", "..", "storage");
const DEMO_PASSWORD = "CaseShield@2026";

function writeDemoFile(caseId: string, documentId: string, version: number, filename: string, content: string) {
  const dir = path.join(STORAGE_ROOT, caseId, documentId);
  fs.mkdirSync(dir, { recursive: true });
  const storedName = `v${version}__${filename}`;
  const fullPath = path.join(dir, storedName);
  fs.writeFileSync(fullPath, content, "utf-8");
  const buf = fs.readFileSync(fullPath);
  return { relPath: path.relative(STORAGE_ROOT, fullPath), hash: sha256Buffer(buf), size: buf.length };
}

function demoDocText(kind: string, caseTitle: string, caseNumber: string) {
  return [
    `CASE SHIELD - FICTIONAL DEMONSTRATION DOCUMENT`,
    `================================================`,
    `Document type: ${kind}`,
    `Related case: ${caseNumber} - ${caseTitle}`,
    `Generated: ${now()}`,
    ``,
    `This file is synthetic content created for the Case Shield prototype.`,
    `It does not describe a real person, real investigation, or real court`,
    `matter. It exists so the document management, versioning and SHA-256`,
    `integrity verification workflows have something real to hash and check.`,
    ``,
    `--- END OF DEMONSTRATION DOCUMENT ---`,
  ].join("\n");
}

export function seed() {
  initSchema();
  if (isSeeded()) {
    console.log("Database already seeded - skipping.");
    return;
  }

  console.log("Seeding Case Shield demo database...");
  const passwordHash = hashPassword(DEMO_PASSWORD);

  const insertUser = db.prepare(
    `INSERT INTO users (id, employee_id, name, email, password_hash, role, department) VALUES (@id, @employee_id, @name, @email, @password_hash, @role, @department)`
  );

  const userDefs: { employee_id: string; name: string; email: string; role: Role; department: string }[] = [
    { employee_id: "INV-1001", name: "Rohan Mehta", email: "rohan.mehta@caseshield.demo", role: "Investigator", department: "Cyber Crime Unit" },
    { employee_id: "SINV-1002", name: "Ananya Kapoor", email: "ananya.kapoor@caseshield.demo", role: "Senior Investigator", department: "Special Investigation Unit" },
    { employee_id: "FOR-1003", name: "Devika Rao", email: "devika.rao@caseshield.demo", role: "Forensic Officer", department: "Digital Forensics Lab" },
    { employee_id: "PROS-1004", name: "Karan Sethi", email: "karan.sethi@caseshield.demo", role: "Prosecutor", department: "Office of Public Prosecutor" },
    { employee_id: "JUD-1005", name: "Justice Meera Iyer", email: "meera.iyer@caseshield.demo", role: "Judge", department: "District Judiciary" },
    { employee_id: "LAW-1006", name: "Arjun Malhotra", email: "arjun.malhotra@caseshield.demo", role: "Lawyer", department: "Malhotra & Associates" },
    { employee_id: "CRT-1007", name: "Priya Nair", email: "priya.nair@caseshield.demo", role: "Court Staff", department: "Registrar Office" },
    { employee_id: "LIT-1008", name: "Sanjay Verma", email: "sanjay.verma@caseshield.demo", role: "Litigant", department: "External Party" },
    { employee_id: "ADM-1009", name: "Neha Joshi", email: "neha.joshi@caseshield.demo", role: "System Administrator", department: "IT Administration" },
    { employee_id: "AUD-1010", name: "Vikram Desai", email: "vikram.desai@caseshield.demo", role: "Auditor", department: "Compliance & Audit Office" },
  ];

  const users: Record<string, { id: string; name: string; role: Role }> = {};
  for (const u of userDefs) {
    const uid = id();
    insertUser.run({ id: uid, employee_id: u.employee_id, name: u.name, email: u.email, password_hash: passwordHash, role: u.role, department: u.department });
    users[u.employee_id] = { id: uid, name: u.name, role: u.role };
  }

  // --- Role permission defaults ------------------------------------------------
  const insertRolePerm = db.prepare(
    `INSERT INTO role_permissions (id, role, resource_type, action, effect) VALUES (?, ?, ?, ?, 'ALLOW')`
  );
  for (const role of Object.keys(ROLE_PERMISSIONS) as Role[]) {
    for (const [resourceType, action] of ROLE_PERMISSIONS[role]) {
      insertRolePerm.run(id(), role, resourceType, action);
    }
  }

  // --- Courts / forums ----------------------------------------------------------
  const insertCourt = db.prepare(`INSERT INTO courts (id, name, type) VALUES (?, ?, ?)`);
  const courtDefs = [
    ["District Court, Sector 12", "District Court"],
    ["Sessions Court, Central District", "Sessions Court"],
    ["High Court (Metro Bench)", "High Court"],
    ["Family Court, Central Division", "Family Court"],
    ["Consumer Disputes Redressal Forum", "Consumer Forum"],
    ["Labour Tribunal, Regional Bench", "Labour Tribunal"],
    ["Income Tax Appellate Tribunal", "Tax Tribunal"],
    ["National Green Tribunal (Demo Bench)", "Environmental Tribunal"],
    ["Company Law Tribunal", "Corporate Tribunal"],
    ["Election Commission Tribunal (Demo Bench)", "Election Tribunal"],
    ["Motor Accident Claims Tribunal", "Compensation Tribunal"],
    ["Probate & Succession Registry", "Testamentary Registry"],
  ];
  const courts: Record<string, string> = {};
  for (const [name, type] of courtDefs) {
    const cid = id();
    insertCourt.run(cid, name, type);
    courts[name] = cid;
  }

  // --- Case categories + types ---------------------------------------------------
  const insertCategory = db.prepare(`INSERT INTO case_categories (id, name, description, sort_order) VALUES (?, ?, ?, ?)`);
  const insertType = db.prepare(`INSERT INTO case_types (id, category_id, name) VALUES (?, ?, ?)`);

  const categoryDefs: { name: string; description: string; types: string[]; court: string }[] = [
    { name: "Civil Matters", description: "Contract, recovery and general civil disputes.", types: ["Contract Dispute", "Civil Recovery Suit"], court: "District Court, Sector 12" },
    { name: "Criminal Matters", description: "Investigations and prosecutions under criminal law.", types: ["Cyber Fraud Investigation", "Theft & Burglary", "Assault Case"], court: "Sessions Court, Central District" },
    { name: "Family & Personal Matters", description: "Divorce, custody and domestic matters.", types: ["Divorce Proceeding", "Child Custody"], court: "Family Court, Central Division" },
    { name: "Tribunal & Regulatory Matters", description: "Regulatory compliance and licensing disputes.", types: ["Regulatory Compliance Review", "Licensing Dispute"], court: "High Court (Metro Bench)" },
    { name: "Corporate & Commercial Matters", description: "Corporate fraud and commercial disputes.", types: ["Corporate Fraud Investigation", "Shareholder Dispute"], court: "Company Law Tribunal" },
    { name: "Tax & Revenue Matters", description: "Tax appeals and revenue disputes.", types: ["Income Tax Appeal", "GST Dispute"], court: "Income Tax Appellate Tribunal" },
    { name: "Constitutional, Writ & PIL Matters", description: "Writ petitions and public interest litigation.", types: ["Public Interest Litigation", "Writ Petition"], court: "High Court (Metro Bench)" },
    { name: "Accident & Compensation Matters", description: "Motor accident and injury compensation claims.", types: ["Motor Accident Claim", "Workplace Injury Claim"], court: "Motor Accident Claims Tribunal" },
    { name: "Property, Land & Housing Matters", description: "Land title and tenancy disputes.", types: ["Land Title Dispute", "Tenancy Dispute"], court: "District Court, Sector 12" },
    { name: "Labour & Employment Matters", description: "Employment termination and wage disputes.", types: ["Wrongful Termination", "Wage Dispute"], court: "Labour Tribunal, Regional Bench" },
    { name: "Consumer Matters", description: "Consumer protection and product liability.", types: ["Product Liability", "Service Deficiency Claim"], court: "Consumer Disputes Redressal Forum" },
    { name: "Election & Public Governance", description: "Election petitions and governance complaints.", types: ["Election Petition", "Governance Complaint"], court: "Election Commission Tribunal (Demo Bench)" },
    { name: "Environmental Matters", description: "Pollution compliance and environmental clearance.", types: ["Pollution Compliance Case", "Environmental Clearance Dispute"], court: "National Green Tribunal (Demo Bench)" },
    { name: "Succession / Probate / Testamentary Matters", description: "Probate petitions and will contests.", types: ["Probate Petition", "Will Contest"], court: "Probate & Succession Registry" },
  ];

  const categories: { id: string; name: string; typeIds: Record<string, string>; defaultCourt: string }[] = [];
  categoryDefs.forEach((c, idx) => {
    const catId = id();
    insertCategory.run(catId, c.name, c.description, idx);
    const typeIds: Record<string, string> = {};
    for (const t of c.types) {
      const tid = id();
      insertType.run(tid, catId, t);
      typeIds[t] = tid;
    }
    categories.push({ id: catId, name: c.name, typeIds, defaultCourt: c.court });
  });

  // --- Helper to create a case ----------------------------------------------------
  const insertCase = db.prepare(
    `INSERT INTO cases (id, case_number, title, case_type_id, court_id, status, priority, summary, assigned_investigator_id, created_by, created_at, updated_at)
     VALUES (@id, @case_number, @title, @case_type_id, @court_id, @status, @priority, @summary, @assigned_investigator_id, @created_by, @created_at, @updated_at)`
  );
  const insertStakeholder = db.prepare(
    `INSERT INTO case_stakeholders (id, case_id, user_id, role_in_case) VALUES (?, ?, ?, ?)`
  );

  let caseCounter = 427;
  function nextCaseNumber() {
    return `CASE-2026-${String(caseCounter++).padStart(5, "0")}`;
  }

  function createCase(opts: {
    category: (typeof categories)[number];
    typeName: string;
    title: string;
    status: string;
    priority: string;
    summary: string;
    investigator: { id: string; name: string; role: Role };
    stakeholders: { id: string; name: string; role: Role }[];
    createdDaysAgo: number;
  }) {
    const caseId = id();
    const caseNumber = nextCaseNumber();
    const createdAt = new Date(Date.now() - opts.createdDaysAgo * 86400000).toISOString();
    insertCase.run({
      id: caseId,
      case_number: caseNumber,
      title: opts.title,
      case_type_id: opts.category.typeIds[opts.typeName],
      court_id: courts[opts.category.defaultCourt],
      status: opts.status,
      priority: opts.priority,
      summary: opts.summary,
      assigned_investigator_id: opts.investigator.id,
      created_by: opts.investigator.id,
      created_at: createdAt,
      updated_at: createdAt,
    });
    for (const sh of opts.stakeholders) {
      insertStakeholder.run(id(), caseId, sh.id, sh.role);
    }
    writeAudit({
      actor: opts.investigator,
      action: "Case Created",
      resourceType: "case",
      resourceId: caseId,
      caseId,
      result: "Success",
      metadata: { case_number: caseNumber, title: opts.title },
    });
    return { caseId, caseNumber, title: opts.title };
  }

  const investigator = users["INV-1001"];
  const seniorInvestigator = users["SINV-1002"];
  const forensicOfficer = users["FOR-1003"];
  const prosecutor = users["PROS-1004"];
  const judge = users["JUD-1005"];
  const lawyer = users["LAW-1006"];
  const courtStaff = users["CRT-1007"];
  const litigant = users["LIT-1008"];
  const admin = users["ADM-1009"];
  const auditor = users["AUD-1010"];

  // --- Flagship case: Cyber Fraud Investigation (rich data) ----------------------
  const flagship = createCase({
    category: categories[1], // Criminal Matters
    typeName: "Cyber Fraud Investigation",
    title: "Cyber Fraud Investigation",
    status: "Under Investigation",
    priority: "High",
    summary:
      "Investigation into a suspected online payment fraud scheme affecting multiple complainants. Digital devices and transaction records have been seized for forensic analysis.",
    investigator,
    stakeholders: [
      { id: seniorInvestigator.id, name: seniorInvestigator.name, role: seniorInvestigator.role },
      { id: forensicOfficer.id, name: forensicOfficer.name, role: forensicOfficer.role },
      { id: prosecutor.id, name: prosecutor.name, role: prosecutor.role },
      { id: judge.id, name: judge.name, role: judge.role },
    ],
    createdDaysAgo: 42,
  });

  // Documents for flagship case
  const insertDocument = db.prepare(
    `INSERT INTO documents (id, case_id, document_number, filename, document_type, description, confidentiality_level, access_level, tags, current_version, status, uploaded_by, created_at, updated_at)
     VALUES (@id, @case_id, @document_number, @filename, @document_type, @description, @confidentiality_level, @access_level, @tags, @current_version, @status, @uploaded_by, @created_at, @updated_at)`
  );
  const insertVersion = db.prepare(
    `INSERT INTO document_versions (id, document_id, version_number, previous_version_id, storage_path, original_filename, mime_type, size_bytes, sha256_hash, uploaded_by, change_description, created_at)
     VALUES (@id, @document_id, @version_number, @previous_version_id, @storage_path, @original_filename, @mime_type, @size_bytes, @sha256_hash, @uploaded_by, @change_description, @created_at)`
  );
  const insertSignature = db.prepare(
    `INSERT INTO document_signatures (id, document_id, version_id, signer_id, status, signed_at, document_hash, verification_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );

  let docCounter = 1;
  function nextDocNumber() {
    return `DOC-2026-${String(docCounter++).padStart(5, "0")}`;
  }

  function addDocument(opts: {
    caseId: string;
    caseNumber: string;
    caseTitle: string;
    filename: string;
    documentType: string;
    description: string;
    confidentiality: "Restricted" | "Confidential" | "Internal" | "Case Team Only";
    tags: string[];
    uploadedBy: { id: string; name: string; role: Role };
    daysAgo: number;
  }) {
    const documentId = id();
    const documentNumber = nextDocNumber();
    const createdAt = new Date(Date.now() - opts.daysAgo * 86400000).toISOString();
    const content = demoDocText(opts.documentType, opts.caseTitle, opts.caseNumber);
    const written = writeDemoFile(opts.caseId, documentId, 1, opts.filename, content);

    insertDocument.run({
      id: documentId,
      case_id: opts.caseId,
      document_number: documentNumber,
      filename: opts.filename,
      document_type: opts.documentType,
      description: opts.description,
      confidentiality_level: opts.confidentiality,
      access_level: opts.confidentiality,
      tags: opts.tags.join(","),
      current_version: 1,
      status: "Active",
      uploaded_by: opts.uploadedBy.id,
      created_at: createdAt,
      updated_at: createdAt,
    });

    const versionId = id();
    insertVersion.run({
      id: versionId,
      document_id: documentId,
      version_number: 1,
      previous_version_id: null,
      storage_path: written.relPath,
      original_filename: opts.filename,
      mime_type: "text/plain",
      size_bytes: written.size,
      sha256_hash: written.hash,
      uploaded_by: opts.uploadedBy.id,
      change_description: "Initial upload",
      created_at: createdAt,
    });

    insertSignature.run(id(), documentId, versionId, null, "Integration Ready", null, written.hash, "Not Applicable");

    writeAudit({
      actor: opts.uploadedBy,
      action: "Document Uploaded",
      resourceType: "document",
      resourceId: documentId,
      caseId: opts.caseId,
      result: "Success",
      metadata: { document_number: documentNumber, filename: opts.filename, sha256_hash: written.hash },
    });

    return { documentId, documentNumber, versionId, hash: written.hash };
  }

  const firDoc = addDocument({
    caseId: flagship.caseId,
    caseNumber: flagship.caseNumber,
    caseTitle: flagship.title,
    filename: "FIR_CaseShield_00427.txt",
    documentType: "FIR / Police Report",
    description: "First Information Report filed by the complainant.",
    confidentiality: "Internal",
    tags: ["fir", "intake"],
    uploadedBy: investigator,
    daysAgo: 42,
  });

  addDocument({
    caseId: flagship.caseId,
    caseNumber: flagship.caseNumber,
    caseTitle: flagship.title,
    filename: "Investigation_Report_v1.txt",
    documentType: "Investigation Report",
    description: "Preliminary investigation findings and transaction trail.",
    confidentiality: "Confidential",
    tags: ["investigation"],
    uploadedBy: investigator,
    daysAgo: 30,
  });

  const witnessDoc = addDocument({
    caseId: flagship.caseId,
    caseNumber: flagship.caseNumber,
    caseTitle: flagship.title,
    filename: "Witness_Statement_Complainant.txt",
    documentType: "Witness Statement",
    description: "Recorded statement from the primary complainant.",
    confidentiality: "Case Team Only",
    tags: ["witness"],
    uploadedBy: seniorInvestigator,
    daysAgo: 28,
  });

  const forensicDoc = addDocument({
    caseId: flagship.caseId,
    caseNumber: flagship.caseNumber,
    caseTitle: flagship.title,
    filename: "Forensic_Report_Device_Analysis.txt",
    documentType: "Forensic Report",
    description: "Digital forensic analysis of the seized mobile device and storage media.",
    confidentiality: "Restricted",
    tags: ["forensics", "device-analysis"],
    uploadedBy: forensicOfficer,
    daysAgo: 20,
  });

  // Add a second version of the investigation report to demonstrate versioning
  {
    const docRow = db
      .prepare("SELECT id FROM documents WHERE filename = 'Investigation_Report_v1.txt'")
      .get() as { id: string };
    const docId = docRow.id;
    const createdAt = new Date(Date.now() - 15 * 86400000).toISOString();
    const content = demoDocText("Investigation Report (Revised)", flagship.title, flagship.caseNumber) + "\n\nRevision: added updated transaction trail analysis.";
    const written = writeDemoFile(flagship.caseId, docId, 2, "Investigation_Report_v2.txt", content);
    const v1 = db.prepare("SELECT id FROM document_versions WHERE document_id = ? AND version_number = 1").get(docId) as { id: string };
    const versionId = id();
    insertVersion.run({
      id: versionId,
      document_id: docId,
      version_number: 2,
      previous_version_id: v1.id,
      storage_path: written.relPath,
      original_filename: "Investigation_Report_v2.txt",
      mime_type: "text/plain",
      size_bytes: written.size,
      sha256_hash: written.hash,
      uploaded_by: seniorInvestigator.id,
      change_description: "Added updated transaction trail analysis after bank records were received.",
      created_at: createdAt,
    });
    db.prepare("UPDATE documents SET current_version = 2, updated_at = ? WHERE id = ?").run(createdAt, docId);
    writeAudit({
      actor: seniorInvestigator,
      action: "Document Version Created",
      resourceType: "document",
      resourceId: docId,
      caseId: flagship.caseId,
      result: "Success",
      metadata: { version: 2, sha256_hash: written.hash },
    });
  }

  // Evidence + chain of custody for flagship case
  const insertEvidence = db.prepare(
    `INSERT INTO evidence (id, evidence_code, case_id, evidence_type, description, collected_by, collection_date, current_custodian_id, integrity_status, chain_status, created_at)
     VALUES (@id, @evidence_code, @case_id, @evidence_type, @description, @collected_by, @collection_date, @current_custodian_id, @integrity_status, @chain_status, @created_at)`
  );
  const insertCustody = db.prepare(
    `INSERT INTO custody_events (id, evidence_id, from_person_id, to_person_id, from_role, to_role, action, reason, status, event_timestamp)
     VALUES (@id, @evidence_id, @from_person_id, @to_person_id, @from_role, @to_role, @action, @reason, @status, @event_timestamp)`
  );

  let evCounter = 1;
  function nextEvidenceCode() {
    return `EV-2026-${String(evCounter++).padStart(3, "0")}`;
  }

  function addEvidence(evType: string, description: string, custodyChain: { person: { id: string; name: string; role: Role }; action: string; reason: string; daysAgo: number }[]) {
    const evidenceId = id();
    const code = nextEvidenceCode();
    const collectedAt = new Date(Date.now() - custodyChain[0].daysAgo * 86400000).toISOString();
    insertEvidence.run({
      id: evidenceId,
      evidence_code: code,
      case_id: flagship.caseId,
      evidence_type: evType,
      description,
      collected_by: custodyChain[0].person.id,
      collection_date: collectedAt,
      current_custodian_id: custodyChain[custodyChain.length - 1].person.id,
      integrity_status: "Verified",
      chain_status: "In Custody",
      created_at: collectedAt,
    });

    let previous: { id: string; name: string; role: Role } | null = null;
    for (const step of custodyChain) {
      const ts = new Date(Date.now() - step.daysAgo * 86400000).toISOString();
      insertCustody.run({
        id: id(),
        evidence_id: evidenceId,
        from_person_id: previous?.id ?? null,
        to_person_id: step.person.id,
        from_role: previous?.role ?? null,
        to_role: step.person.role,
        action: step.action,
        reason: step.reason,
        status: "Completed",
        event_timestamp: ts,
      });
      writeAudit({
        actor: step.person,
        action: `Evidence ${step.action}`,
        resourceType: "evidence",
        resourceId: evidenceId,
        caseId: flagship.caseId,
        result: "Success",
        metadata: { evidence_code: code, from: previous?.role ?? "Intake", to: step.person.role },
      });
      previous = step.person;
    }
    return evidenceId;
  }

  addEvidence("Digital Device", "Seized mobile phone believed to be used in the fraud scheme.", [
    { person: investigator, action: "Collected", reason: "Seized during search under warrant.", daysAgo: 41 },
    { person: forensicOfficer, action: "Transferred", reason: "Sent for forensic imaging.", daysAgo: 39 },
    { person: forensicOfficer, action: "Examined", reason: "Forensic imaging and analysis performed.", daysAgo: 35 },
    { person: seniorInvestigator, action: "Received", reason: "Returned to case file after analysis.", daysAgo: 30 },
    { person: prosecutor, action: "Submitted", reason: "Shared with prosecution for review.", daysAgo: 18 },
  ]);

  addEvidence("Storage Media", "External hard drive recovered from the suspect's residence.", [
    { person: investigator, action: "Collected", reason: "Seized during search under warrant.", daysAgo: 41 },
    { person: forensicOfficer, action: "Transferred", reason: "Sent for forensic imaging.", daysAgo: 38 },
    { person: forensicOfficer, action: "Verified", reason: "Hash verification completed post-imaging.", daysAgo: 34 },
  ]);

  addEvidence("Forensic Image", "Bit-for-bit forensic image of the seized digital device.", [
    { person: forensicOfficer, action: "Collected", reason: "Forensic image created from source device.", daysAgo: 39 },
    { person: forensicOfficer, action: "Verified", reason: "Image hash verified against source.", daysAgo: 39 },
    { person: seniorInvestigator, action: "Received", reason: "Archived with case file.", daysAgo: 33 },
    { person: prosecutor, action: "Submitted", reason: "Provided to prosecution as supporting evidence.", daysAgo: 18 },
    { person: judge, action: "Examined", reason: "Reviewed as part of case proceedings.", daysAgo: 5 },
  ]);

  // Access requests for flagship case
  const insertAccessRequest = db.prepare(
    `INSERT INTO access_requests (id, case_id, requester_id, role, resource_type, resource_id, resource_label, permission, reason, requested_at, expiry, status, reviewer_id, reviewed_at)
     VALUES (@id, @case_id, @requester_id, @role, @resource_type, @resource_id, @resource_label, @permission, @reason, @requested_at, @expiry, @status, @reviewer_id, @reviewed_at)`
  );
  const insertDocPermission = db.prepare(
    `INSERT INTO document_permissions (id, document_id, user_id, permission, granted_by, granted_at, expires_at, source_access_request_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );

  function addAccessRequest(opts: {
    requester: { id: string; name: string; role: Role };
    resourceType: string;
    resourceId: string;
    resourceLabel: string;
    permission: string;
    reason: string;
    status: "Pending" | "Approved" | "Rejected" | "Expired" | "Revoked";
    reviewer?: { id: string; name: string; role: Role };
    requestedDaysAgo: number;
    reviewedDaysAgo?: number;
    expiryDaysFromNow?: number;
    grantDocumentId?: string;
  }) {
    const reqId = id();
    const requestedAt = new Date(Date.now() - opts.requestedDaysAgo * 86400000).toISOString();
    const reviewedAt = opts.reviewedDaysAgo !== undefined ? new Date(Date.now() - opts.reviewedDaysAgo * 86400000).toISOString() : null;
    const expiry = opts.expiryDaysFromNow !== undefined ? new Date(Date.now() + opts.expiryDaysFromNow * 86400000).toISOString() : null;

    insertAccessRequest.run({
      id: reqId,
      case_id: flagship.caseId,
      requester_id: opts.requester.id,
      role: opts.requester.role,
      resource_type: opts.resourceType,
      resource_id: opts.resourceId,
      resource_label: opts.resourceLabel,
      permission: opts.permission,
      reason: opts.reason,
      requested_at: requestedAt,
      expiry,
      status: opts.status,
      reviewer_id: opts.reviewer?.id ?? null,
      reviewed_at: reviewedAt,
    });

    writeAudit({
      actor: opts.requester,
      action: "Access Requested",
      resourceType: "access_request",
      resourceId: reqId,
      caseId: flagship.caseId,
      result: "Success",
      metadata: { resource_label: opts.resourceLabel, permission: opts.permission },
    });

    if (opts.status === "Approved" && opts.reviewer) {
      writeAudit({
        actor: opts.reviewer,
        action: "Access Approved",
        resourceType: "access_request",
        resourceId: reqId,
        caseId: flagship.caseId,
        result: "Success",
        metadata: { requester: opts.requester.name, resource_label: opts.resourceLabel },
      });
      if (opts.grantDocumentId) {
        insertDocPermission.run(id(), opts.grantDocumentId, opts.requester.id, opts.permission, opts.reviewer.id, reviewedAt ?? now(), expiry, reqId);
      }
    } else if (opts.status === "Rejected" && opts.reviewer) {
      writeAudit({
        actor: opts.reviewer,
        action: "Access Rejected",
        resourceType: "access_request",
        resourceId: reqId,
        caseId: flagship.caseId,
        result: "Denied",
        metadata: { requester: opts.requester.name, resource_label: opts.resourceLabel },
      });
    } else if (opts.status === "Revoked" && opts.reviewer) {
      writeAudit({
        actor: opts.reviewer,
        action: "Access Revoked",
        resourceType: "access_request",
        resourceId: reqId,
        caseId: flagship.caseId,
        result: "Success",
        metadata: { requester: opts.requester.name, resource_label: opts.resourceLabel },
      });
    }

    return reqId;
  }

  addAccessRequest({
    requester: lawyer,
    resourceType: "document",
    resourceId: forensicDoc.documentId,
    resourceLabel: "Forensic Report - Device Analysis",
    permission: "View",
    reason: "Required to prepare defense submissions ahead of the next hearing.",
    status: "Pending",
    requestedDaysAgo: 2,
  });

  addAccessRequest({
    requester: prosecutor,
    resourceType: "document",
    resourceId: forensicDoc.documentId,
    resourceLabel: "Forensic Report - Device Analysis",
    permission: "View",
    reason: "Needed to prepare the charge sheet.",
    status: "Approved",
    reviewer: seniorInvestigator,
    requestedDaysAgo: 19,
    reviewedDaysAgo: 18,
    expiryDaysFromNow: 60,
    grantDocumentId: forensicDoc.documentId,
  });

  addAccessRequest({
    requester: litigant,
    resourceType: "document",
    resourceId: witnessDoc.documentId,
    resourceLabel: "Witness Statement - Complainant",
    permission: "View",
    reason: "Requesting access as the affected party in the case.",
    status: "Rejected",
    reviewer: seniorInvestigator,
    requestedDaysAgo: 10,
    reviewedDaysAgo: 9,
  });

  addAccessRequest({
    requester: courtStaff,
    resourceType: "document",
    resourceId: firDoc.documentId,
    resourceLabel: "FIR / Police Report",
    permission: "Download",
    reason: "Required for registry filing records.",
    status: "Revoked",
    reviewer: seniorInvestigator,
    requestedDaysAgo: 25,
    reviewedDaysAgo: 24,
  });

  addAccessRequest({
    requester: auditor,
    resourceType: "case",
    resourceId: flagship.caseId,
    resourceLabel: "Full case audit access",
    permission: "View",
    reason: "Quarterly compliance review of active investigations.",
    status: "Expired",
    reviewer: admin,
    requestedDaysAgo: 90,
    reviewedDaysAgo: 89,
    expiryDaysFromNow: -30,
  });

  // --- Lighter-weight cases for every other category ------------------------------
  const otherCaseSpecs: { catIdx: number; typeName: string; title: string; status: string; priority: string; docType: string }[] = [
    { catIdx: 0, typeName: "Contract Dispute", title: "Breach of Supply Agreement", status: "In Progress", priority: "Medium", docType: "Court Filing" },
    { catIdx: 2, typeName: "Child Custody", title: "Custody Arrangement Review", status: "Pending Hearing", priority: "Medium", docType: "Court Filing" },
    { catIdx: 3, typeName: "Licensing Dispute", title: "Operating License Revocation Review", status: "Under Review", priority: "Low", docType: "Legal Notice" },
    { catIdx: 4, typeName: "Corporate Fraud Investigation", title: "Shell Company Fund Diversion", status: "Under Investigation", priority: "High", docType: "Investigation Report" },
    { catIdx: 5, typeName: "Income Tax Appeal", title: "Assessment Year Reassessment Appeal", status: "Filed", priority: "Medium", docType: "Court Filing" },
    { catIdx: 6, typeName: "Public Interest Litigation", title: "Public Records Access Petition", status: "Pending Hearing", priority: "Medium", docType: "Court Filing" },
    { catIdx: 7, typeName: "Motor Accident Claim", title: "Highway Collision Compensation Claim", status: "In Progress", priority: "Medium", docType: "Evidence Record" },
    { catIdx: 8, typeName: "Land Title Dispute", title: "Disputed Title Transfer", status: "Under Review", priority: "Low", docType: "Court Filing" },
    { catIdx: 9, typeName: "Wrongful Termination", title: "Employment Termination Grievance", status: "Filed", priority: "Medium", docType: "Legal Notice" },
    { catIdx: 10, typeName: "Product Liability", title: "Defective Appliance Injury Claim", status: "In Progress", priority: "Medium", docType: "Evidence Record" },
    { catIdx: 11, typeName: "Election Petition", title: "Municipal Election Result Challenge", status: "Pending Hearing", priority: "High", docType: "Court Filing" },
    { catIdx: 12, typeName: "Pollution Compliance Case", title: "Industrial Effluent Compliance Review", status: "Under Investigation", priority: "Medium", docType: "Investigation Report" },
    { catIdx: 13, typeName: "Probate Petition", title: "Estate Probate Filing", status: "Filed", priority: "Low", docType: "Court Filing" },
  ];

  otherCaseSpecs.forEach((spec, i) => {
    const cat = categories[spec.catIdx];
    const inv = i % 3 === 0 ? seniorInvestigator : investigator;
    const c = createCase({
      category: cat,
      typeName: spec.typeName,
      title: spec.title,
      status: spec.status,
      priority: spec.priority,
      summary: `Demonstration case record for ${cat.name.toLowerCase()} used to populate the Case Shield prototype.`,
      investigator: inv,
      stakeholders: [{ id: lawyer.id, name: lawyer.name, role: lawyer.role }],
      createdDaysAgo: 10 + i * 4,
    });
    addDocument({
      caseId: c.caseId,
      caseNumber: c.caseNumber,
      caseTitle: c.title,
      filename: `${spec.docType.replace(/[^a-zA-Z0-9]+/g, "_")}_${c.caseNumber}.txt`,
      documentType: spec.docType,
      description: `${spec.docType} associated with ${c.title}.`,
      confidentiality: i % 4 === 0 ? "Restricted" : "Internal",
      tags: [cat.name.split(" ")[0].toLowerCase()],
      uploadedBy: inv,
      daysAgo: 8 + i * 3,
    });
  });

  // --- Notifications ---------------------------------------------------------------
  const insertNotification = db.prepare(
    `INSERT INTO notifications (id, user_id, type, message, link, is_read, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  insertNotification.run(id(), investigator.id, "access_request", "A pending access request needs review on CASE-2026-00427.", `/cases/${flagship.caseId}/access-requests`, 0, now());
  insertNotification.run(id(), seniorInvestigator.id, "access_request", "Lawyer Arjun Malhotra requested access to the Forensic Report.", `/cases/${flagship.caseId}/access-requests`, 0, now());
  insertNotification.run(id(), forensicOfficer.id, "evidence", "Evidence EV-2026-003 was submitted to the prosecution.", `/cases/${flagship.caseId}/evidence`, 1, now());
  insertNotification.run(id(), admin.id, "system", "System audit log check-in: audit chain verified clean on last run.", `/audit-log`, 1, now());
  insertNotification.run(id(), auditor.id, "audit", "Quarterly compliance review window is open for active cases.", `/audit-log`, 0, now());

  // --- Baseline system audit events (logins) ---------------------------------------
  for (const u of Object.values(users)) {
    writeAudit({ actor: u, action: "Login", resourceType: "system", result: "Success", metadata: { method: "password" } });
  }
  writeAudit({
    actor: null,
    action: "Failed Login",
    resourceType: "system",
    result: "Failure",
    metadata: { employee_id: "INV-1099", reason: "invalid_password" },
  });

  console.log("Seed complete.");
  console.log(`Demo password for every seeded user: ${DEMO_PASSWORD}`);
}

if (require.main === module) {
  seed();
}
