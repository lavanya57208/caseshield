/**
 * Case Shield — development seed data.
 *
 * Everything here is FICTIONAL: no real FIR numbers, no real personal data,
 * no real officer identities, no real court records. See
 * docs/product-requirements.md §"Demo Data" for the constraints this seed
 * script follows.
 */
import dotenv from "dotenv";
import path from "path";

// Load .env from the repository root regardless of cwd, matching
// backend/src/config/env.ts — this script runs standalone (via tsx), not
// through the backend app, so it needs its own explicit load.
dotenv.config({ path: path.resolve(__dirname, "../.env") });

import { Prisma, PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import fs from "fs";
import { ALL_PERMISSIONS, ROLE_BASELINE_PERMISSIONS } from "../backend/src/lib/permissions";
import { buildFictionalContactSheetPdf } from "./fixtures/fictional-pii-document";
import { buildScannedPng, scannedFirText } from "./fixtures/ocr-fixtures";
import { computeCustodyEventHash } from "../backend/src/modules/evidence/custody-chain";

const prisma = new PrismaClient();

const DEMO_PASSWORD = "CaseShield#2026";
const STORAGE_DIR = path.resolve(__dirname, "../backend/storage-dev");

async function writeDemoFile(relKey: string, content: string): Promise<{ key: string; hash: string; size: number }> {
  const fullPath = path.join(STORAGE_DIR, relKey);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, "utf-8");
  const buf = fs.readFileSync(fullPath);
  const hash = crypto.createHash("sha256").update(buf).digest("hex");
  return { key: relKey, hash, size: buf.length };
}

async function main() {
  console.log("Seeding Case Shield development data...");

  // --- Roles & permissions -------------------------------------------------
  const permissionRows = await Promise.all(
    ALL_PERMISSIONS.map((p) =>
      prisma.permission.upsert({
        where: { key: p.key },
        create: p,
        update: { resource: p.resource, action: p.action, description: p.description },
      }),
    ),
  );
  const permissionByKey = new Map(permissionRows.map((p) => [p.key, p]));

  const roleDefs: { key: string; name: string; description: string }[] = [
    { key: "INVESTIGATOR", name: "Investigator / Police Officer", description: "Frontline investigation and evidence handling." },
    { key: "SENIOR_INVESTIGATOR", name: "Senior Investigator", description: "Oversees investigations, approves access, assigns teams." },
    { key: "FORENSIC_OFFICER", name: "Forensic Officer", description: "Handles forensic evidence and laboratory reports." },
    { key: "PROSECUTOR", name: "Prosecutor", description: "Prepares and pursues prosecution using case documents." },
    { key: "JUDGE", name: "Judge / Court Authority", description: "Reviews submitted case materials for adjudication." },
    { key: "LAWYER", name: "Lawyer / Advocate", description: "Represents a party and requests access to relevant materials." },
    { key: "COURT_STAFF", name: "Court Staff", description: "Administers court filings and records." },
    { key: "AUTHORIZED_PARTY", name: "Authorized Party / Litigant", description: "A party to a case with narrowly scoped access." },
    { key: "AUDITOR", name: "Auditor / Compliance Officer", description: "Reviews access, audit, and security events across cases." },
    { key: "ADMIN", name: "System Administrator", description: "Manages users, roles, and system configuration." },
  ];

  const roles = new Map<string, { id: string; key: string }>();
  for (const r of roleDefs) {
    const role = await prisma.role.upsert({ where: { key: r.key }, create: r, update: { name: r.name, description: r.description } });
    roles.set(r.key, role);

    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    const grants = ROLE_BASELINE_PERMISSIONS[r.key] ?? [];
    for (const permKey of grants) {
      const perm = permissionByKey.get(permKey);
      if (perm) {
        await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: perm.id } });
      }
    }
  }

  // --- Organization ----------------------------------------------------------
  const org = await prisma.organization.upsert({
    where: { id: "00000000-0000-0000-0000-000000000001" },
    create: { id: "00000000-0000-0000-0000-000000000001", name: "State Investigation Bureau (Demo)", type: "AGENCY" },
    update: {},
  });

  // --- Demo users --------------------------------------------------------------
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  const userDefs = [
    { email: "investigator@caseshield.local", fullName: "Officer Arjun Mehta", officialIdentifier: "SIB-INV-1042", department: "Field Investigation Unit", role: "INVESTIGATOR" },
    { email: "senior@caseshield.local", fullName: "Inspector Kavita Rao", officialIdentifier: "SIB-SNR-0221", department: "Investigation Command", role: "SENIOR_INVESTIGATOR" },
    { email: "forensic@caseshield.local", fullName: "Dr. Neha Iyer", officialIdentifier: "FSL-FOR-0087", department: "Forensic Science Laboratory", role: "FORENSIC_OFFICER" },
    { email: "prosecutor@caseshield.local", fullName: "Adv. Rohan Kapoor", officialIdentifier: "PROS-3391", department: "Directorate of Prosecution", role: "PROSECUTOR" },
    { email: "judge@caseshield.local", fullName: "Hon. Justice S. Nair", officialIdentifier: "COURT-JD-0044", department: "District & Sessions Court", role: "JUDGE" },
    { email: "lawyer@caseshield.local", fullName: "Adv. Priya Sharma", officialIdentifier: "BAR-77123", department: "Independent Practice", role: "LAWYER" },
    { email: "courtstaff@caseshield.local", fullName: "Mr. Vikram Das", officialIdentifier: "COURT-ST-1290", department: "District Court Registry", role: "COURT_STAFF" },
    { email: "auditor@caseshield.local", fullName: "Ms. Ananya Ghosh", officialIdentifier: "AUD-5510", department: "Compliance & Audit Cell", role: "AUDITOR" },
    { email: "admin@caseshield.local", fullName: "System Administrator", officialIdentifier: "SYS-ADM-0001", department: "IT Administration", role: "ADMIN" },
  ];

  const users = new Map<string, { id: string; email: string; fullName: string }>();
  for (const u of userDefs) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      create: {
        email: u.email,
        fullName: u.fullName,
        officialIdentifier: u.officialIdentifier,
        department: u.department,
        organizationId: org.id,
        passwordHash,
        status: "ACTIVE",
      },
      update: { fullName: u.fullName, department: u.department },
    });
    users.set(u.email, user);
    const role = roles.get(u.role)!;
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      create: { userId: user.id, roleId: role.id },
      update: {},
    });
  }

  const investigator = users.get("investigator@caseshield.local")!;
  const senior = users.get("senior@caseshield.local")!;
  const forensic = users.get("forensic@caseshield.local")!;
  const prosecutor = users.get("prosecutor@caseshield.local")!;
  const judge = users.get("judge@caseshield.local")!;
  const lawyer = users.get("lawyer@caseshield.local")!;
  const auditor = users.get("auditor@caseshield.local")!;
  const admin = users.get("admin@caseshield.local")!;

  // --- Case classification ---------------------------------------------------
  const categoryDefs: { key: string; name: string; types: string[] }[] = [
    { key: "CRIMINAL", name: "Criminal Matters", types: ["Criminal Investigation", "Cognizable Offense", "Cybercrime", "Economic Offense"] },
    { key: "CIVIL", name: "Civil Matters", types: ["Contract Dispute", "Property Suit"] },
    { key: "FAMILY", name: "Family & Personal Matters", types: ["Matrimonial", "Custody"] },
    { key: "TRIBUNAL", name: "Tribunal & Regulatory Matters", types: ["Consumer Tribunal", "Administrative Appeal"] },
    { key: "CORPORATE", name: "Corporate & Commercial Matters", types: ["Company Dispute", "Insolvency"] },
    { key: "TAX", name: "Tax & Revenue Matters", types: ["Direct Tax", "Indirect Tax"] },
    { key: "WRIT", name: "Constitutional / Writ / PIL Matters", types: ["Writ Petition", "Public Interest Litigation"] },
    { key: "ACCIDENT", name: "Accident & Compensation Matters", types: ["Motor Accident Claim", "Workplace Injury"] },
    { key: "PROPERTY", name: "Property / Land / Housing Matters", types: ["Land Dispute", "Tenancy"] },
    { key: "LABOUR", name: "Labour & Employment Matters", types: ["Wrongful Termination", "Wage Dispute"] },
    { key: "CONSUMER", name: "Consumer Matters", types: ["Product Liability", "Service Deficiency"] },
    { key: "ELECTION", name: "Election & Public Governance", types: ["Election Petition"] },
    { key: "ENVIRONMENT", name: "Environmental Matters", types: ["Pollution Control", "Land Use"] },
    { key: "SUCCESSION", name: "Succession / Probate / Testamentary Matters", types: ["Probate", "Inheritance Dispute"] },
  ];

  const caseTypeByKey = new Map<string, { id: string; categoryId: string }>();
  for (const [i, c] of categoryDefs.entries()) {
    const category = await prisma.caseCategory.upsert({
      where: { key: c.key },
      create: { key: c.key, name: c.name, sortOrder: i },
      update: { name: c.name, sortOrder: i },
    });
    for (const [j, typeName] of c.types.entries()) {
      const typeKey = typeName.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
      const type = await prisma.caseType.upsert({
        where: { categoryId_key: { categoryId: category.id, key: typeKey } },
        create: { categoryId: category.id, key: typeKey, name: typeName, sortOrder: j },
        update: { name: typeName, sortOrder: j },
      });
      caseTypeByKey.set(`${c.key}:${typeKey}`, { id: type.id, categoryId: category.id });
    }
  }

  // --- Retention policy --------------------------------------------------------
  const standardRetention = await prisma.retentionPolicy.upsert({
    where: { id: "00000000-0000-0000-0000-000000000010" },
    create: { id: "00000000-0000-0000-0000-000000000010", name: "Standard Investigation Retention", description: "Default retention for active investigation records.", defaultRetentionDays: 3650, allowsLegalHold: true },
    update: {},
  });

  // --- Primary demo case: CASE-2026-00427 -------------------------------------
  const criminalType = caseTypeByKey.get("CRIMINAL:COGNIZABLE_OFFENSE")!;

  const existingCase = await prisma.case.findUnique({ where: { caseNumber: "CASE-2026-00427" } });
  const primaryCase =
    existingCase ??
    (await prisma.case.create({
      data: {
        caseNumber: "CASE-2026-00427",
        title: "State Investigation — Digital Evidence Review",
        categoryId: criminalType.categoryId,
        typeId: criminalType.id,
        court: "District & Sessions Court, Sector 12",
        jurisdiction: "Central Metropolitan District",
        status: "ACTIVE",
        priority: "HIGH",
        confidentiality: "CONFIDENTIAL",
        investigatingOfficerId: investigator.id,
        organizationId: org.id,
        description:
          "Fictional demonstration case involving a reported cybercrime incident. Investigation covers digital evidence collection, forensic imaging, and witness statements. All details are synthetic and created for the Case Shield prototype demonstration.",
        createdBy: investigator.id,
        tags: { create: [{ tag: "cybercrime" }, { tag: "digital-evidence" }, { tag: "priority-review" }] },
      },
    }));

  await prisma.caseAssignment.upsert({
    where: { caseId_userId: { caseId: primaryCase.id, userId: investigator.id } },
    create: { caseId: primaryCase.id, userId: investigator.id, roleOnCase: "INVESTIGATING_OFFICER", assignedBy: investigator.id },
    update: {},
  });
  for (const [assignee, roleOnCase] of [
    [senior, "SUPERVISING_OFFICER"],
    [forensic, "FORENSIC_EXAMINER"],
    [prosecutor, "PROSECUTOR"],
  ] as const) {
    await prisma.caseAssignment.upsert({
      where: { caseId_userId: { caseId: primaryCase.id, userId: assignee.id } },
      create: { caseId: primaryCase.id, userId: assignee.id, roleOnCase, assignedBy: investigator.id },
      update: {},
    });
  }

  // Secondary cases, for list/filter/dashboard variety.
  const secondaryDefs = [
    { number: "CASE-2026-00318", title: "Regional Property Dispute — Boundary Encroachment", catKey: "PROPERTY", typeKey: "LAND_DISPUTE", status: "UNDER_REVIEW", priority: "MEDIUM", officer: senior },
    { number: "CASE-2026-00295", title: "Economic Offense — Suspected Financial Fraud", catKey: "CRIMINAL", typeKey: "ECONOMIC_OFFENSE", status: "ACTIVE", priority: "CRITICAL", officer: senior },
    { number: "CASE-2025-00981", title: "Motor Accident Compensation Claim", catKey: "ACCIDENT", typeKey: "MOTOR_ACCIDENT_CLAIM", status: "CLOSED", priority: "LOW", officer: investigator },
  ];
  for (const s of secondaryDefs) {
    const t = caseTypeByKey.get(`${s.catKey}:${s.typeKey}`)!;
    const existing = await prisma.case.findUnique({ where: { caseNumber: s.number } });
    if (!existing) {
      const created = await prisma.case.create({
        data: {
          caseNumber: s.number,
          title: s.title,
          categoryId: t.categoryId,
          typeId: t.id,
          court: "District & Sessions Court, Sector 12",
          jurisdiction: "Central Metropolitan District",
          status: s.status as any,
          priority: s.priority as any,
          confidentiality: "INTERNAL",
          investigatingOfficerId: s.officer.id,
          organizationId: org.id,
          description: `Fictional demonstration case (${s.title}) generated for the Case Shield prototype.`,
          createdBy: s.officer.id,
        },
      });
      await prisma.caseAssignment.create({ data: { caseId: created.id, userId: s.officer.id, roleOnCase: "INVESTIGATING_OFFICER", assignedBy: s.officer.id } });
    }
  }

  // --- Documents for the primary case -----------------------------------------
  const documentDefs = [
    {
      number: "DOC-2026-001839",
      type: "FIR",
      title: "FIR_Report.pdf",
      description: "First Information Report registering the fictional cybercrime complaint.",
      confidentiality: "CONFIDENTIAL",
      uploader: investigator,
      content: "FICTIONAL FIR REPORT\nCase: CASE-2026-00427\nDate: 2026-09-10\nComplainant reports unauthorized access to an organizational account. This is synthetic demonstration content.",
    },
    {
      number: "DOC-2026-001840",
      type: "INVESTIGATION_REPORT",
      title: "Investigation_Report.pdf",
      description: "Initial investigation report summarizing findings to date.",
      confidentiality: "CONFIDENTIAL",
      uploader: investigator,
      content: "FICTIONAL INVESTIGATION REPORT\nCase: CASE-2026-00427\nDate: 2026-09-12\nSummary of investigative steps taken, synthetic content for demonstration only.",
    },
    {
      number: "DOC-2026-001841",
      type: "WITNESS_STATEMENT",
      title: "Witness_Statement.pdf",
      description: "Recorded statement from a fictional witness.",
      confidentiality: "RESTRICTED",
      uploader: investigator,
      content: "FICTIONAL WITNESS STATEMENT\nCase: CASE-2026-00427\nDate: 2026-09-14\nWitness statement content is entirely synthetic and created for demonstration.",
    },
    {
      number: "DOC-2026-001842",
      type: "FORENSIC_REPORT",
      title: "Forensic_Report.pdf",
      description: "Digital forensics laboratory report on the imaged device.",
      confidentiality: "CONFIDENTIAL",
      uploader: forensic,
      content: "FICTIONAL FORENSIC LABORATORY REPORT\nCase: CASE-2026-00427\nLaboratory: Example Forensic Laboratory (fictional)\nReport date: 2026-09-16\nFindings are synthetic demonstration content only.",
    },
    {
      number: "DOC-2026-001843",
      type: "CHARGE_SHEET",
      title: "Charge_Sheet.pdf",
      description: "Draft charge sheet prepared for prosecutorial review.",
      confidentiality: "CONFIDENTIAL",
      uploader: senior,
      content: "FICTIONAL DRAFT CHARGE SHEET\nCase: CASE-2026-00427\nDate: 2026-09-18\nSynthetic demonstration content only.",
    },
  ];

  for (const d of documentDefs) {
    const existingDoc = await prisma.document.findUnique({ where: { documentNumber: d.number } });
    if (existingDoc) continue;
    const stored = await writeDemoFile(`cases/${primaryCase.id}/${d.number}/v1/${d.title}`, d.content);
    const doc = await prisma.document.create({
      data: {
        documentNumber: d.number,
        caseId: primaryCase.id,
        type: d.type as any,
        title: d.title,
        description: d.description,
        confidentiality: d.confidentiality as any,
        status: "REGISTERED",
        retentionPolicyId: standardRetention.id,
        createdBy: d.uploader.id,
      },
    });
    const version = await prisma.documentVersion.create({
      data: {
        documentId: doc.id,
        versionNumber: 1,
        fileName: d.title,
        fileSize: stored.size,
        mimeType: "text/plain",
        sha256Hash: stored.hash,
        storageProvider: "local",
        storageKey: stored.key,
        integrityStatus: "VERIFIED",
        lastVerifiedAt: new Date(),
        uploadedBy: d.uploader.id,
      },
    });
    await prisma.document.update({ where: { id: doc.id }, data: { currentVersionId: version.id } });
    await prisma.digitalSignature.create({ data: { documentId: doc.id, versionId: version.id, status: "NOT_SIGNED" } });
    await prisma.auditEvent.create({
      data: { actorId: d.uploader.id, actorRole: "INVESTIGATOR", action: "DOCUMENT_UPLOADED", resource: `document:${doc.id}`, caseId: primaryCase.id, documentId: doc.id, result: "SUCCESS", requestId: "seed" },
    });
  }

  // A second, tampered version of the forensic report to power the
  // controlled Integrity Verification demo (docs/product-requirements.md
  // §"Integrity Demo"). We deliberately write a mismatched hash on this
  // fixture version rather than truly damaging the primary evidence file.
  const forensicDoc = await prisma.document.findUnique({ where: { documentNumber: "DOC-2026-001842" } });
  if (forensicDoc) {
    const existingV2 = await prisma.documentVersion.findFirst({ where: { documentId: forensicDoc.id, versionNumber: 2 } });
    if (!existingV2) {
      const stored = await writeDemoFile(
        `cases/${primaryCase.id}/${forensicDoc.id}/v2-fixture/Forensic_Report_integrity_fixture.pdf`,
        "FICTIONAL FORENSIC LABORATORY REPORT (fixture)\nThis controlled fixture demonstrates an integrity violation for demo purposes only.",
      );
      await prisma.documentVersion.create({
        data: {
          documentId: forensicDoc.id,
          versionNumber: 2,
          fileName: "Forensic_Report_integrity_fixture.pdf",
          fileSize: stored.size,
          mimeType: "text/plain",
          sha256Hash: "0000000000000000000000000000000000000000000000000000000000fixture", // intentionally mismatched
          storageProvider: "local",
          storageKey: stored.key,
          changeNote: "Controlled fixture for the Integrity Verification demo (docs/product-requirements.md).",
          integrityStatus: "UNVERIFIED",
          uploadedBy: forensic.id,
        },
      });
    }
  }

  // --- Phase 2 demo: a real PDF containing FICTIONAL PII ---------------------
  // Powers the PII scan -> review -> redaction -> watermark -> secure share
  // demo. Every value in it is synthetic (see prisma/fixtures/).
  const piiDemoNumber = "DOC-2026-001844";
  if (!(await prisma.document.findUnique({ where: { documentNumber: piiDemoNumber } }))) {
    const pdf = await buildFictionalContactSheetPdf(primaryCase.caseNumber);
    const key = `cases/${primaryCase.id}/${piiDemoNumber}/v1/Complainant_Contact_Sheet.pdf`;
    const fullPath = path.join(STORAGE_DIR, key);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, pdf);
    const doc = await prisma.document.create({
      data: {
        documentNumber: piiDemoNumber,
        caseId: primaryCase.id,
        type: "WITNESS_STATEMENT",
        title: "Complainant_Contact_Sheet.pdf",
        description: "Fictional complainant contact sheet containing synthetic PII for the PII protection demo.",
        confidentiality: "CONFIDENTIAL",
        status: "REGISTERED",
        retentionPolicyId: standardRetention.id,
        createdBy: investigator.id,
      },
    });
    const version = await prisma.documentVersion.create({
      data: {
        documentId: doc.id,
        versionNumber: 1,
        fileName: "Complainant_Contact_Sheet.pdf",
        fileSize: pdf.length,
        mimeType: "application/pdf",
        sha256Hash: crypto.createHash("sha256").update(pdf).digest("hex"),
        storageProvider: "local",
        storageKey: key,
        integrityStatus: "VERIFIED",
        lastVerifiedAt: new Date(),
        uploadedBy: investigator.id,
      },
    });
    await prisma.document.update({ where: { id: doc.id }, data: { currentVersionId: version.id } });
    await prisma.digitalSignature.create({ data: { documentId: doc.id, versionId: version.id, status: "NOT_SIGNED" } });
    await prisma.auditEvent.create({
      data: { actorId: investigator.id, actorRole: "INVESTIGATOR", action: "DOCUMENT_UPLOADED", resource: `document:${doc.id}`, caseId: primaryCase.id, documentId: doc.id, result: "SUCCESS", requestId: "seed" },
    });
  }

  // --- Phase 4 demo: a "scanned" FIR image for the OCR path -------------------
  // A real PNG with no text layer; the development MockOCRProvider reads its
  // embedded fixture layer (see prisma/fixtures/ocr-fixtures.ts).
  const scannedFirNumber = "DOC-2026-001845";
  if (!(await prisma.document.findUnique({ where: { documentNumber: scannedFirNumber } }))) {
    const png = buildScannedPng({ pages: [{ text: scannedFirText(primaryCase.caseNumber), confidence: 0.92 }], language: "en" });
    const key = `cases/${primaryCase.id}/${scannedFirNumber}/v1/FIR_scan.png`;
    const fullPath = path.join(STORAGE_DIR, key);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, png);
    const doc = await prisma.document.create({
      data: {
        documentNumber: scannedFirNumber,
        caseId: primaryCase.id,
        type: "SUPPORTING_DOCUMENT",
        title: "FIR_scan.png",
        description: "Fictional scanned FIR page (image only) for the OCR / document intelligence demo.",
        confidentiality: "CONFIDENTIAL",
        status: "REGISTERED",
        retentionPolicyId: standardRetention.id,
        createdBy: investigator.id,
      },
    });
    const version = await prisma.documentVersion.create({
      data: {
        documentId: doc.id,
        versionNumber: 1,
        fileName: "FIR_scan.png",
        fileSize: png.length,
        mimeType: "image/png",
        sha256Hash: crypto.createHash("sha256").update(png).digest("hex"),
        storageProvider: "local",
        storageKey: key,
        integrityStatus: "VERIFIED",
        lastVerifiedAt: new Date(),
        uploadedBy: investigator.id,
      },
    });
    await prisma.document.update({ where: { id: doc.id }, data: { currentVersionId: version.id } });
    await prisma.digitalSignature.create({ data: { documentId: doc.id, versionId: version.id, status: "NOT_SIGNED" } });
    await prisma.auditEvent.create({
      data: { actorId: investigator.id, actorRole: "INVESTIGATOR", action: "DOCUMENT_UPLOADED", resource: `document:${doc.id}`, caseId: primaryCase.id, documentId: doc.id, result: "SUCCESS", requestId: "seed" },
    });
  }

  // --- Evidence + hash-linked chains of custody (Phase 3) ----------------------
  // Every event is appended through the same hash function the API uses
  // (backend/src/modules/evidence/custody-chain.ts), so the seeded chains
  // pass custody-chain verification. All people, places and items are fictional.
  type SeedUser = { id: string; fullName: string };
  type SeedStep = {
    action: string;
    by: SeedUser;
    from?: SeedUser | null;
    to?: SeedUser | null;
    reason: string;
    notes?: string;
    at: string;
    transfer?: "open" | "accept";
    audit?: string;
  };

  async function seedEvidence(def: {
    number: string;
    title: string;
    type: string;
    description: string;
    source: string;
    collectedBy: SeedUser;
    registeredBy: SeedUser;
    collectedAt: string;
    location: string;
    confidentiality: "INTERNAL" | "CONFIDENTIAL";
    document?: { number: string; versionNumber: number };
    finalStatus: string;
    finalCustodian: SeedUser;
    submittedAt?: string;
    steps: SeedStep[];
  }) {
    if (await prisma.evidence.findUnique({ where: { evidenceNumber: def.number } })) return;

    let link: { documentId: string; versionId: string; hash: string } | null = null;
    if (def.document) {
      const doc = await prisma.document.findUnique({ where: { documentNumber: def.document.number } });
      const version = doc && (await prisma.documentVersion.findFirst({ where: { documentId: doc.id, versionNumber: def.document.versionNumber } }));
      if (doc && version) {
        const bytes = fs.readFileSync(path.join(STORAGE_DIR, version.storageKey));
        link = { documentId: doc.id, versionId: version.id, hash: crypto.createHash("sha256").update(bytes).digest("hex") };
      }
    }

    const evidence = await prisma.evidence.create({
      data: {
        evidenceNumber: def.number,
        caseId: primaryCase.id,
        title: def.title,
        type: def.type,
        description: def.description,
        source: def.source,
        collectedById: def.collectedBy.id,
        collectedAt: new Date(def.collectedAt),
        location: def.location,
        registeredById: def.registeredBy.id,
        currentCustodianId: def.finalCustodian.id,
        status: def.finalStatus as any,
        confidentiality: def.confidentiality,
        notes: "Synthetic demonstration evidence record.",
        originalDocumentId: link?.documentId,
        originalVersionId: link?.versionId,
        originalHash: link?.hash,
        currentHash: link?.hash,
        integrityStatus: link ? "VERIFIED" : null,
        lastVerifiedAt: link ? new Date(def.steps[def.steps.length - 1].at) : null,
        submittedAt: def.submittedAt ? new Date(def.submittedAt) : null,
      },
    });

    let previousEventHash: string | null = null;
    let sequence = 0;
    let openTransferId: string | null = null;
    let statusBeforeTransfer = "REGISTERED";
    let runningStatus = "REGISTERED";
    const statusAfter: Record<string, string> = { REGISTERED: "REGISTERED", RECEIVED: "IN_CUSTODY", EXAMINED: "UNDER_EXAMINATION", SEALED: "SEALED", UNSEALED: "IN_CUSTODY", SUBMITTED: "SUBMITTED_TO_COURT" };

    for (const step of def.steps) {
      sequence += 1;
      let transferId: string | null = null;
      if (step.transfer === "open") {
        statusBeforeTransfer = runningStatus;
        const t = await prisma.evidenceTransfer.create({
          data: {
            evidenceId: evidence.id,
            fromCustodianId: step.from!.id,
            toCustodianId: step.to!.id,
            initiatedById: step.by.id,
            reason: step.reason,
            notes: step.notes,
            previousStatus: statusBeforeTransfer as any,
            initiatedAt: new Date(step.at),
          },
        });
        openTransferId = t.id;
        transferId = t.id;
        runningStatus = "TRANSFERRED";
      } else if (step.transfer === "accept" && openTransferId) {
        await prisma.evidenceTransfer.update({ where: { id: openTransferId }, data: { status: "ACCEPTED", respondedAt: new Date(step.at), responseNote: step.notes } });
        transferId = openTransferId;
        openTransferId = null;
        runningStatus = statusBeforeTransfer === "SEALED" ? "SEALED" : "IN_CUSTODY";
      } else if (statusAfter[step.action]) {
        runningStatus = statusAfter[step.action];
      }

      const data = {
        evidenceId: evidence.id,
        sequence,
        action: step.action,
        fromUserId: step.from?.id ?? null,
        toUserId: step.to?.id ?? null,
        actorId: step.by.id,
        organizationId: org.id,
        transferId,
        reason: step.reason,
        notes: step.notes ?? null,
        location: step.action === "REGISTERED" ? def.location : null,
        hashAtEvent: link?.hash ?? null,
        occurredAt: new Date(step.at),
        previousEventHash,
      };
      const eventHash = computeCustodyEventHash(data);
      await prisma.custodyEvent.create({ data: { ...data, action: data.action as any, eventHash } });
      previousEventHash = eventHash;

      if (step.audit) {
        await prisma.auditEvent.create({
          data: {
            actorId: step.by.id,
            action: step.audit,
            resource: `evidence:${evidence.id}`,
            caseId: primaryCase.id,
            evidenceId: evidence.id,
            organizationId: org.id,
            result: "SUCCESS",
            reason: step.action === "REGISTERED" || step.action === "RECEIVED" ? null : step.reason,
            requestId: "seed",
            occurredAt: new Date(step.at),
          },
        });
      }
    }

    await prisma.evidence.update({
      where: { id: evidence.id },
      data: { custodyHeadHash: previousEventHash, custodyEventCount: sequence, lastActivityAt: new Date(def.steps[def.steps.length - 1].at) },
    });
  }

  await seedEvidence({
    number: "EVD-2026-00041",
    title: "Forensic Examination Report",
    type: "FORENSIC_REPORT",
    description: "Fictional forensic examination report on the imaged workstation, issued by the demonstration laboratory.",
    source: "Forensic Laboratory",
    collectedBy: forensic,
    registeredBy: forensic,
    collectedAt: "2026-09-16T08:45:00Z",
    location: "Forensic Science Laboratory (fictional), Evidence Room 2",
    confidentiality: "CONFIDENTIAL",
    document: { number: "DOC-2026-001842", versionNumber: 1 },
    finalStatus: "IN_CUSTODY",
    finalCustodian: prosecutor,
    steps: [
      { action: "REGISTERED", by: forensic, to: forensic, reason: "Evidence registered in Case Shield.", at: "2026-09-16T09:10:00Z", audit: "EVIDENCE_REGISTERED" },
      { action: "TRANSFERRED", by: forensic, from: forensic, to: senior, reason: "Supervisory review of findings", transfer: "open", at: "2026-09-16T11:30:00Z", audit: "EVIDENCE_TRANSFER_INITIATED" },
      { action: "RECEIVED", by: senior, from: forensic, to: senior, reason: "Custody received and acknowledged by recipient.", transfer: "accept", at: "2026-09-16T11:42:00Z", audit: "EVIDENCE_TRANSFER_ACCEPTED" },
      { action: "TRANSFERRED", by: senior, from: senior, to: prosecutor, reason: "Prosecution review", transfer: "open", at: "2026-09-18T10:05:00Z", audit: "EVIDENCE_TRANSFER_INITIATED" },
      { action: "RECEIVED", by: prosecutor, from: senior, to: prosecutor, reason: "Custody received and acknowledged by recipient.", transfer: "accept", at: "2026-09-18T14:15:00Z", audit: "EVIDENCE_TRANSFER_ACCEPTED" },
      { action: "VERIFIED", by: prosecutor, reason: "Integrity verified: stored bytes match the registered SHA-256.", at: "2026-09-18T14:20:00Z", audit: "EVIDENCE_VERIFIED" },
    ],
  });

  await seedEvidence({
    number: "EVD-2026-00042",
    title: "Scene Photograph Set",
    type: "PHOTOGRAPH",
    description: "Set of 24 fictional printed scene photographs in a tamper-evident evidence bag.",
    source: "Scene documentation — Site A (fictional)",
    collectedBy: investigator,
    registeredBy: investigator,
    collectedAt: "2026-09-10T10:05:00Z",
    location: "Site A — Fictional Registered Office",
    confidentiality: "CONFIDENTIAL",
    finalStatus: "UNDER_EXAMINATION",
    finalCustodian: forensic,
    steps: [
      { action: "REGISTERED", by: investigator, to: investigator, reason: "Evidence registered in Case Shield.", at: "2026-09-10T11:20:00Z", audit: "EVIDENCE_REGISTERED" },
      { action: "SEALED", by: investigator, from: investigator, to: investigator, reason: "Sealed in evidence bag SB-0042 (fictional)", at: "2026-09-10T11:35:00Z", audit: "EVIDENCE_SEALED" },
      { action: "TRANSFERRED", by: investigator, from: investigator, to: forensic, reason: "Forensic examination", transfer: "open", at: "2026-09-11T09:10:00Z", audit: "EVIDENCE_TRANSFER_INITIATED" },
      { action: "RECEIVED", by: forensic, from: investigator, to: forensic, reason: "Custody received and acknowledged by recipient.", notes: "Seal intact on receipt.", transfer: "accept", at: "2026-09-11T11:42:00Z", audit: "EVIDENCE_TRANSFER_ACCEPTED" },
      { action: "UNSEALED", by: forensic, from: forensic, to: forensic, reason: "Opened for examination in laboratory", at: "2026-09-11T13:00:00Z", audit: "EVIDENCE_UNSEALED" },
      { action: "EXAMINED", by: forensic, from: forensic, to: forensic, reason: "Photographic comparison examination", notes: "Fictional examination notes.", at: "2026-09-11T14:15:00Z", audit: "EVIDENCE_EXAMINED" },
    ],
  });

  await seedEvidence({
    number: "EVD-2026-00043",
    title: "Digital Evidence Package",
    type: "DIGITAL_EVIDENCE",
    description: "Fictional sealed package containing an encrypted USB drive with extracted log files.",
    source: "Suspect workstation extraction (fictional)",
    collectedBy: investigator,
    registeredBy: investigator,
    collectedAt: "2026-09-19T15:30:00Z",
    location: "Site A — Fictional Registered Office",
    confidentiality: "CONFIDENTIAL",
    finalStatus: "TRANSFERRED",
    finalCustodian: investigator,
    steps: [
      { action: "REGISTERED", by: investigator, to: investigator, reason: "Evidence registered in Case Shield.", at: "2026-09-19T16:00:00Z", audit: "EVIDENCE_REGISTERED" },
      { action: "TRANSFERRED", by: investigator, from: investigator, to: forensic, reason: "Forensic examination", notes: "Awaiting laboratory receipt.", transfer: "open", at: "2026-09-24T09:30:00Z", audit: "EVIDENCE_TRANSFER_INITIATED" },
    ],
  });

  // Pre-Phase 3 demo item. Only created on a fresh database — an existing
  // row is migrated in place and its legacy chain sealed below.
  await seedEvidence({
    number: "EVD-2026-00091",
    title: "Forensic disk image — suspect workstation",
    type: "DIGITAL_EVIDENCE",
    description: "Forensic disk image of the fictional suspect workstation (demonstration data only).",
    source: "Site A — Fictional Registered Office",
    collectedBy: investigator,
    registeredBy: investigator,
    collectedAt: "2026-09-10T10:32:00Z",
    location: "Site A — Fictional Registered Office",
    confidentiality: "CONFIDENTIAL",
    finalStatus: "UNDER_EXAMINATION",
    finalCustodian: forensic,
    steps: [
      { action: "COLLECTED", by: investigator, to: investigator, reason: "Evidence collected at the scene.", at: "2026-09-10T10:32:00Z" },
      { action: "REGISTERED", by: investigator, from: investigator, to: investigator, reason: "Registered into Case Shield.", at: "2026-09-10T12:15:00Z" },
      { action: "TRANSFERRED", by: investigator, from: investigator, to: forensic, reason: "Transferred for forensic imaging and analysis.", transfer: "open", at: "2026-09-10T14:42:00Z" },
      { action: "RECEIVED", by: forensic, from: investigator, to: forensic, reason: "Forensic Officer acknowledged receipt.", transfer: "accept", at: "2026-09-10T16:12:00Z" },
      { action: "EXAMINED", by: forensic, from: forensic, to: forensic, reason: "Forensic imaging and analysis performed.", at: "2026-09-10T18:32:00Z" },
    ],
  });

  // One-time sealing of custody chains recorded before Phase 3 (the
  // migration numbers them but cannot hash them). Only events that have
  // never been sealed are hashed; a sealed chain is never rewritten.
  const legacy = await prisma.evidence.findMany({ where: { custodyEvents: { some: { eventHash: null } } }, select: { id: true } });
  for (const { id } of legacy) {
    const events = await prisma.custodyEvent.findMany({ where: { evidenceId: id }, orderBy: { sequence: "asc" } });
    if (events.some((e) => e.eventHash)) {
      console.warn(`Skipping legacy sealing for evidence ${id}: chain is partially sealed and needs manual review.`);
      continue;
    }
    let previousEventHash: string | null = null;
    for (const e of events) {
      const eventHash = computeCustodyEventHash({ ...e, previousEventHash });
      await prisma.custodyEvent.update({ where: { id: e.id }, data: { previousEventHash, eventHash } });
      previousEventHash = eventHash;
    }
    await prisma.evidence.update({ where: { id }, data: { custodyHeadHash: previousEventHash, custodyEventCount: events.length } });
    console.log(`Sealed legacy custody chain for evidence ${id} (${events.length} events).`);
  }

  // --- Access request example (Prosecutor requesting document access) -------
  const forensicDocForAccess = await prisma.document.findUnique({ where: { documentNumber: "DOC-2026-001842" } });
  const existingAccessRequest = await prisma.accessRequest.findFirst({
    where: { requestedById: prosecutor.id, caseId: primaryCase.id, documentId: forensicDocForAccess?.id },
  });
  if (!existingAccessRequest && forensicDocForAccess) {
    await prisma.accessRequest.create({
      data: {
        caseId: primaryCase.id,
        documentId: forensicDocForAccess.id,
        requestedById: prosecutor.id,
        permissionKey: "document.download",
        reason: "Preparing prosecution filing; require the forensic report for the charge sheet annexure.",
        durationDays: 30,
        status: "PENDING",
      },
    });
  }

  // --- Sample notifications ----------------------------------------------------
  const evd43 = await prisma.evidence.findUnique({ where: { evidenceNumber: "EVD-2026-00043" }, select: { id: true } });
  // Created only if an identical notification does not exist yet, so the
  // seed stays re-runnable (createMany's skipDuplicates cannot dedupe UUID rows).
  const sampleNotifications: Prisma.NotificationCreateManyInput[] = [
      { userId: senior.id, type: "ACCESS_REQUESTED", title: "New access request", body: "Adv. Rohan Kapoor requested document.download on CASE-2026-00427.", relatedCaseId: primaryCase.id, isRead: false },
      { userId: forensic.id, type: "EVIDENCE_TRANSFERRED", title: "Evidence transferred to you", body: "EVD-2026-00091 was transferred to you for examination.", relatedCaseId: primaryCase.id, isRead: true },
      ...(evd43 ? [{ userId: forensic.id, type: "EVIDENCE_TRANSFERRED" as const, title: "Evidence Transfer Request", body: "EVD-2026-00043 · From: Officer Arjun Mehta · Reason: Forensic examination", relatedCaseId: primaryCase.id, relatedEvidenceId: evd43.id, isRead: false }] : []),
      { userId: investigator.id, type: "PENDING_ACTION", title: "Pending review", body: "Charge sheet draft awaits senior review on CASE-2026-00427.", relatedCaseId: primaryCase.id, isRead: false },
  ];
  for (const n of sampleNotifications) {
    if (!(await prisma.notification.findFirst({ where: { userId: n.userId, title: n.title, body: n.body } }))) {
      await prisma.notification.create({ data: n });
    }
  }

  // --- Sample security events --------------------------------------------------
  const sampleSecurityEvents: Prisma.SecurityEventCreateManyInput[] = [
    { type: "FAILED_LOGIN", detail: "3 failed login attempts for unknown@example.com within 5 minutes.", severity: "LOW" },
    { type: "SUSPICIOUS_ACCESS", caseId: primaryCase.id, detail: "Access attempt to a RESTRICTED document outside business hours (demo fixture).", severity: "MEDIUM" },
  ];
  for (const e of sampleSecurityEvents) {
    if (!(await prisma.securityEvent.findFirst({ where: { type: e.type, detail: e.detail } }))) await prisma.securityEvent.create({ data: e });
  }

  // --- Phase 4: queue document intelligence for every current version --------
  // Only QUEUED rows + jobs are created here; the API server's in-process
  // worker picks them up at startup (DOCUMENT_PROCESSING_MODE=auto).
  const unprocessed = await prisma.document.findMany({
    where: { deletedAt: null, currentVersionId: { not: null }, intelligence: { none: {} } },
    select: { id: true, caseId: true, createdBy: true, currentVersionId: true },
  });
  for (const d of unprocessed) {
    const intel = await prisma.documentIntelligence.create({
      data: { documentId: d.id, versionId: d.currentVersionId!, caseId: d.caseId, requestedById: d.createdBy },
    });
    await prisma.aiProcessingJob.create({
      data: { documentId: d.id, versionId: d.currentVersionId!, intelligenceId: intel.id, jobType: "PROCESS_DOCUMENT", status: "QUEUED", requestedBy: d.createdBy },
    });
  }
  if (unprocessed.length) console.log(`Queued document intelligence for ${unprocessed.length} document(s); the API processes them on startup.`);

  console.log("Seed complete.");
  console.log(`Demo password for every seeded account: ${DEMO_PASSWORD}`);
  console.log("Accounts:", userDefs.map((u) => u.email).join(", "));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
