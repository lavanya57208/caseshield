import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import { createApp } from "../../../backend/src/app";
import { prisma } from "../../../backend/src/lib/prisma";
import { env } from "../../../backend/src/config/env";
import { getStorageProvider } from "../../../backend/src/modules/storage";
import { getProcessingQueue } from "../../../backend/src/modules/ai/processing/processing-queue";
import { FICTIONAL_PII, RAW_PII_VALUES } from "../../../prisma/fixtures/fictional-pii-document";
import { buildScannedPdf, buildScannedPng, scannedFirText, scannedWitnessText } from "../../../prisma/fixtures/ocr-fixtures";

// End-to-end tests of Phase 4 (OCR / AI document intelligence and
// authorization-aware search) through the real Express app and the isolated
// PostgreSQL test database. The queue runs in "manual" mode here: uploads
// only queue work, and drain() runs it deterministically. Everything is fictional.

const app = createApp();
const DAY = 24 * 60 * 60 * 1000;
const drain = () => getProcessingQueue().drain();

type Actor = { id: string; token: string };
const actors: Record<string, Actor> = {};
const auth = (name: string) => ({ Authorization: `Bearer ${actors[name].token}` });
const digits = () => String(Math.floor(100000 + Math.random() * 899999));

let caseId: string;
let caseNumber: string;
let otherCaseId: string;
const docs: Record<string, string> = {};

async function makeUser(name: string, roleKey: string, organizationId: string) {
  const role = await prisma.role.upsert({ where: { key: roleKey }, create: { key: roleKey, name: roleKey }, update: {} });
  const user = await prisma.user.create({
    data: {
      email: `p4-${name}.${uuidv4().slice(0, 8)}@example.com`,
      fullName: `Test ${name}`,
      organizationId,
      passwordHash: "not-used-in-tests",
      userRoles: { create: { roleId: role.id } },
    },
  });
  const session = await prisma.session.create({ data: { userId: user.id, tokenHash: uuidv4(), expiresAt: new Date(Date.now() + DAY) } });
  actors[name] = { id: user.id, token: jwt.sign({ sub: user.id, sessionId: session.id }, env.JWT_SECRET, { expiresIn: "1h" }) };
}

async function upload(
  as: string,
  opts: { title: string; bytes: Buffer; fileName: string; contentType: string; type?: string; confidentiality?: string; targetCase?: string },
) {
  const res = await request(app)
    .post("/api/documents")
    .set(auth(as))
    .field("caseId", opts.targetCase ?? caseId)
    .field("type", opts.type ?? "SUPPORTING_DOCUMENT")
    .field("title", opts.title)
    .field("confidentiality", opts.confidentiality ?? "CONFIDENTIAL")
    .attach("file", opts.bytes, { filename: opts.fileName, contentType: opts.contentType });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.document;
}

const intelligence = async (as: string, id: string) => request(app).get(`/api/documents/${id}/intelligence`).set(auth(as));
const search = (as: string, query: Record<string, string>) => request(app).get("/api/search/documents").set(auth(as)).query(query);

function expectNoRawPii(value: unknown) {
  const serialized = JSON.stringify(value);
  for (const raw of RAW_PII_VALUES) expect(serialized, `raw PII leaked: ${raw}`).not.toContain(raw);
}

beforeAll(async () => {
  const org = await prisma.organization.create({ data: { name: "Fictional Bureau (phase 4 test)" } });
  const otherOrg = await prisma.organization.create({ data: { name: "Other Fictional Agency (phase 4 test)" } });
  await makeUser("investigator", "INVESTIGATOR", org.id);
  await makeUser("forensic", "FORENSIC_OFFICER", org.id);
  await makeUser("lawyer", "LAWYER", org.id);
  await makeUser("admin", "ADMIN", org.id);
  await makeUser("outsider", "INVESTIGATOR", org.id); // same org, not on the case
  await makeUser("foreignAdmin", "ADMIN", otherOrg.id);

  const category = await prisma.caseCategory.create({ data: { key: `P4_${uuidv4().slice(0, 6)}`, name: "Criminal (phase 4 test)" } });
  const type = await prisma.caseType.create({ data: { categoryId: category.id, key: "THEFT", name: "Theft" } });
  caseNumber = `CASE-2024-${digits()}`;
  const c = await prisma.case.create({
    data: {
      caseNumber,
      title: "Fictional vehicle theft case",
      categoryId: category.id,
      typeId: type.id,
      court: "Fictional Court",
      jurisdiction: "Fictional District",
      organizationId: org.id,
      investigatingOfficerId: actors.investigator.id,
      description: "Synthetic case for automated tests.",
      createdBy: actors.investigator.id,
      assignments: { create: ["investigator", "forensic", "lawyer"].map((m) => ({ userId: actors[m].id, roleOnCase: m.toUpperCase(), assignedBy: actors.investigator.id })) },
    },
  });
  caseId = c.id;
  const other = await prisma.case.create({
    data: {
      caseNumber: `CASE-2024-${digits()}`,
      title: "Unrelated fictional case",
      categoryId: category.id,
      typeId: type.id,
      court: "Fictional Court",
      jurisdiction: "Fictional District",
      organizationId: org.id,
      investigatingOfficerId: actors.outsider.id,
      description: "Case the investigator is not on.",
      createdBy: actors.outsider.id,
    },
  });
  otherCaseId = other.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("upload → queue → pipeline", () => {
  it("upload returns immediately with QUEUED processing; nothing runs until the worker drains", async () => {
    const text = `${scannedFirText(caseNumber)}\nComplainant phone: ${FICTIONAL_PII.phone}\nAadhaar: ${FICTIONAL_PII.aadhaar}\n`;
    const doc = await upload("investigator", { title: "FIR 0421 text copy", bytes: Buffer.from(text, "utf-8"), fileName: "fir.txt", contentType: "text/plain" });
    docs.textFir = doc.id;
    expect(doc.intelligence.processingStatus).toBe("QUEUED");

    const before = await intelligence("investigator", doc.id);
    expect(before.status).toBe(200);
    expect(before.body.intelligence.processing.status).toBe("QUEUED");
    const job = await prisma.aiProcessingJob.findUniqueOrThrow({ where: { id: doc.intelligence.jobId } });
    expect(job).toMatchObject({ jobType: "PROCESS_DOCUMENT", status: "QUEUED" });

    await drain();
  });

  it("text-layer document: extracted, PII-masked, classified, metadata extracted, summarized and indexed", async () => {
    const res = await intelligence("investigator", docs.textFir);
    const i = res.body.intelligence;
    expect(i.processing.status).toBe("COMPLETED");
    expect(i.extraction).toMatchObject({ status: "TEXT_EXTRACTED", textSource: "TEXT_LAYER", masked: true });
    expect(i.pii.status).toBe("COMPLETED");
    expect(i.pii.findingCount).toBeGreaterThanOrEqual(3);
    expect(i.classification).toMatchObject({ status: "COMPLETED", suggestedType: "FIR", review: "PENDING_REVIEW", provenance: "AI_GENERATED" });
    expect(i.metadata.extracted.caseNumber.value).toBe(caseNumber);
    expect(i.metadata.extracted.documentDate.value).toBe("2024-03-12");
    expect(i.summary.status).toBe("COMPLETED");
    expect(i.summary.text).toMatch(/two-wheeler/);
    expect(i.index.status).toBe("COMPLETED");
    expect(res.body.intelligence.disclaimer).toMatch(/not legal advice/i);
    // Neither the preview, the summary nor the stored row contains raw PII.
    expectNoRawPii(res.body);
    const row = await prisma.documentIntelligence.findFirstOrThrow({ where: { documentId: docs.textFir } });
    expectNoRawPii(row);
    // Original stored document still carries the raw values (derived data only was masked).
    const version = await prisma.documentVersion.findFirstOrThrow({ where: { documentId: docs.textFir } });
    expect((await getStorageProvider().get(version.storageKey)).toString("utf-8")).toContain(FICTIONAL_PII.phone);
  });

  it("records the pipeline in the audit trail without document content or raw PII", async () => {
    const rows = await prisma.auditEvent.findMany({ where: { documentId: docs.textFir }, orderBy: { occurredAt: "asc" } });
    const actions = rows.map((r) => r.action);
    for (const a of ["DOCUMENT_UPLOADED", "AI_PROCESSING_QUEUED", "AI_PROCESSING_STARTED", "DOCUMENT_CLASSIFIED", "DOCUMENT_METADATA_EXTRACTED", "DOCUMENT_SUMMARY_GENERATED", "AI_PROCESSING_COMPLETED"]) {
      expect(actions).toContain(a);
    }
    expect(actions).not.toContain("OCR_STARTED"); // text layer, no OCR
    expectNoRawPii(rows);
    expect(JSON.stringify(rows)).not.toContain("two-wheeler");
  });

  it("scanned PNG goes through OCR (mock provider) and is classified from the recognized text", async () => {
    const png = buildScannedPng({ pages: [{ text: scannedFirText(caseNumber), confidence: 0.91 }], language: "en" });
    const doc = await upload("investigator", { title: "Scanned FIR page", bytes: png, fileName: "fir-scan.png", contentType: "image/png" });
    docs.scannedFir = doc.id;
    await drain();
    const i = (await intelligence("investigator", doc.id)).body.intelligence;
    expect(i.extraction).toMatchObject({ status: "OCR_PROCESSED", textSource: "OCR", confidence: 0.91, language: "en" });
    expect(i.extraction.provider).toMatch(/MockOCRProvider/);
    expect(i.extraction.limitations.join(" ")).toMatch(/fixture layer/);
    expect(i.classification.suggestedType).toBe("FIR");
    expect(i.extraction.textPreview).not.toContain(FICTIONAL_PII.email);
    const actions = (await prisma.auditEvent.findMany({ where: { documentId: doc.id } })).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(["OCR_STARTED", "OCR_COMPLETED"]));
  });

  it("scanned PDF without a text layer takes the OCR path; a witness statement is recognized", async () => {
    const pdf = await buildScannedPdf({ pages: [{ text: scannedWitnessText(caseNumber, "EVD-2024-00007") }] });
    const doc = await upload("forensic", { title: "Scanned witness statement", bytes: pdf, fileName: "witness.pdf", contentType: "application/pdf" });
    docs.scannedWitness = doc.id;
    await drain();
    const i = (await intelligence("forensic", doc.id)).body.intelligence;
    expect(i.extraction.status).toBe("OCR_PROCESSED");
    expect(i.classification.suggestedType).toBe("WITNESS_STATEMENT");
    expect(i.metadata.extracted.evidenceIds.value).toEqual(["EVD-2024-00007"]);
  });

  it("an image with no recognizable text is reported honestly: extraction FAILED, AI steps SKIPPED, overall PARTIAL", async () => {
    const doc = await upload("investigator", { title: "Blank scan", bytes: buildScannedPng(), fileName: "blank.png", contentType: "image/png" });
    docs.blank = doc.id;
    await drain();
    const i = (await intelligence("investigator", doc.id)).body.intelligence;
    expect(i.processing.status).toBe("PARTIAL");
    expect(i.extraction.status).toBe("FAILED");
    expect(i.extraction.error).toMatch(/No text could be recognized/);
    expect(i.classification.status).toBe("SKIPPED");
    expect(i.summary.status).toBe("SKIPPED");
    expect(i.summary.text).toBeNull();
    expect(i.index.status).toBe("SKIPPED");
  });

  it("RESTRICTED documents are never sent to OCR or AI; their text layer is still indexed", async () => {
    const scan = buildScannedPng({ pages: [{ text: scannedFirText(caseNumber) }] });
    const restrictedScan = await upload("investigator", { title: "Restricted scan", bytes: scan, fileName: "r.png", contentType: "image/png", confidentiality: "RESTRICTED" });
    const restrictedText = await upload("investigator", {
      title: "Restricted informant note",
      bytes: Buffer.from("Informant note: meeting near the old granary regarding the stolen two-wheeler.", "utf-8"),
      fileName: "note.txt",
      contentType: "text/plain",
      confidentiality: "RESTRICTED",
    });
    docs.restrictedText = restrictedText.id;
    await drain();

    const scanRow = await prisma.documentIntelligence.findFirstOrThrow({ where: { documentId: restrictedScan.id } });
    expect(scanRow.extractionStatus).toBe("SKIPPED");
    expect(scanRow.extractionError).toMatch(/RESTRICTED/);
    expect(scanRow.classificationStatus).toBe("SKIPPED");
    const scanActions = (await prisma.auditEvent.findMany({ where: { documentId: restrictedScan.id } })).map((r) => r.action);
    expect(scanActions).not.toContain("OCR_STARTED");

    const textRow = await prisma.documentIntelligence.findFirstOrThrow({ where: { documentId: restrictedText.id } });
    expect(textRow.extractionStatus).toBe("TEXT_EXTRACTED");
    expect(textRow.summaryStatus).toBe("SKIPPED");
    expect(textRow.summaryReason).toMatch(/RESTRICTED/);
    expect(textRow.indexStatus).toBe("COMPLETED");
  });
});

describe("intelligence API authorization", () => {
  it("denies users outside the case, and cross-organization admins, with an audited DENIED event", async () => {
    for (const who of ["outsider", "foreignAdmin"]) {
      const res = await intelligence(who, docs.textFir);
      expect(res.status, who).toBe(403);
      expect(JSON.stringify(res.body)).not.toContain("two-wheeler");
    }
    const denied = await prisma.auditEvent.findMany({ where: { documentId: docs.textFir, action: "DOCUMENT_INTELLIGENCE_VIEWED", result: "DENIED" } });
    expect(denied.length).toBeGreaterThanOrEqual(2);
  });

  it("a RESTRICTED document's intelligence needs an explicit grant (role baseline is not enough)", async () => {
    expect((await intelligence("investigator", docs.restrictedText)).status).toBe(403);
    expect((await intelligence("admin", docs.restrictedText)).status).toBe(200);
  });

  it("reports capabilities: a lawyer can read but not reprocess or review", async () => {
    const res = await intelligence("lawyer", docs.textFir);
    expect(res.status).toBe(200);
    expect(res.body.capabilities).toMatchObject({ canReprocess: false, canReview: false });
    expect((await request(app).post(`/api/documents/${docs.textFir}/intelligence/reprocess`).set(auth("lawyer"))).status).toBe(403);
    const review = await request(app).post(`/api/documents/${docs.textFir}/intelligence/classification/review`).set(auth("lawyer")).send({ decision: "CONFIRM" });
    expect(review.status).toBe(403);
  });
});

describe("authorization-aware search", () => {
  it("full-text search finds OCR and text-layer documents, with masked snippets", async () => {
    const res = await search("investigator", { q: "two-wheeler stolen" });
    expect(res.status).toBe(200);
    const ids = res.body.results.map((r: any) => r.documentId);
    expect(ids).toEqual(expect.arrayContaining([docs.textFir, docs.scannedFir]));
    const hit = res.body.results.find((r: any) => r.documentId === docs.textFir);
    expect(hit.snippet).toMatch(/\[\[/);
    expect(hit.matchedOn).toContain("text");
    expectNoRawPii(res.body);
  });

  it("never returns — or counts — documents the caller cannot view", async () => {
    // RESTRICTED note matches the query but the investigator lacks an explicit grant.
    const inv = await search("investigator", { q: "granary" });
    expect(inv.body.total).toBe(0);
    expect(inv.body.results).toEqual([]);

    for (const who of ["outsider", "foreignAdmin"]) {
      const res = await search(who, { q: "two-wheeler" });
      expect(res.status).toBe(200);
      expect(res.body.total, who).toBe(0);
      expect(JSON.stringify(res.body)).not.toContain(caseNumber);
    }
    // An in-org oversight role sees the RESTRICTED document.
    const admin = await search("admin", { q: "granary" });
    expect(admin.body.results.map((r: any) => r.documentId)).toEqual([docs.restrictedText]);
  });

  it("a PII value cannot be used to find a document (only masked text is indexed)", async () => {
    const res = await search("investigator", { q: FICTIONAL_PII.email });
    expect(res.body.results.map((r: any) => r.documentId)).not.toContain(docs.textFir);
  });

  it("filters by case and AI-suggested type", async () => {
    const res = await search("investigator", { q: "parking", caseId, documentType: "WITNESS_STATEMENT" });
    expect(res.body.results.map((r: any) => r.documentId)).toEqual([docs.scannedWitness]);
    expect((await search("investigator", { q: "" })).status).toBe(400);
  });

  it("intelligent search interprets types and case numbers, and explains itself", async () => {
    const res = await search("investigator", { q: `witness statement in ${caseNumber}`, mode: "intelligent" });
    expect(res.status).toBe(200);
    expect(res.body.interpretation.documentTypes).toContain("WITNESS_STATEMENT");
    expect(res.body.interpretation.caseNumbers).toEqual([caseNumber]);
    expect(res.body.results[0].documentId).toBe(docs.scannedWitness);
    expect(res.body.ranking.semanticProvider).toMatch(/MockEmbeddingProvider/);

    const byEvidence = await search("investigator", { q: "EVD-2024-00007", mode: "intelligent" });
    expect(byEvidence.body.interpretation.evidenceNumbers).toEqual(["EVD-2024-00007"]);
  });

  it("audits searches by shape only — never the query text", async () => {
    await search("investigator", { q: "complainant granary secretword" });
    const row = await prisma.auditEvent.findFirstOrThrow({ where: { actorId: actors.investigator.id, action: "DOCUMENT_SEARCH_PERFORMED" }, orderBy: { occurredAt: "desc" } });
    expect(JSON.stringify(row)).not.toContain("secretword");
    expect((row.metadata as any).queryLength).toBe("complainant granary secretword".length);
  });
});

describe("human review of AI output", () => {
  it("confirming a classification records HUMAN_CONFIRMED without touching the document's type", async () => {
    const res = await request(app).post(`/api/documents/${docs.textFir}/intelligence/classification/review`).set(auth("investigator")).send({ decision: "CONFIRM" });
    expect(res.status).toBe(200);
    expect(res.body.intelligence.classification).toMatchObject({ review: "CONFIRMED", provenance: "HUMAN_CONFIRMED", confirmedType: "FIR", reviewedBy: actors.investigator.id });
    const doc = await prisma.document.findUniqueOrThrow({ where: { id: docs.textFir } });
    expect(doc.type).toBe("SUPPORTING_DOCUMENT");
  });

  it("correcting a classification can apply the reviewed type to the document record (audited)", async () => {
    const res = await request(app)
      .post(`/api/documents/${docs.scannedFir}/intelligence/classification/review`)
      .set(auth("investigator"))
      .send({ decision: "CORRECT", type: "POLICE_REPORT", applyToDocument: true });
    expect(res.status).toBe(200);
    expect(res.body.intelligence.classification).toMatchObject({ provenance: "AI_ASSISTED", confirmedType: "POLICE_REPORT" });
    expect((await prisma.document.findUniqueOrThrow({ where: { id: docs.scannedFir } })).type).toBe("POLICE_REPORT");
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { documentId: docs.scannedFir, action: "AI_CLASSIFICATION_REVIEWED" } });
    expect(audit.metadata).toMatchObject({ decision: "CORRECT", suggestedType: "FIR", confirmedType: "POLICE_REPORT", appliedToDocument: true, previousDocumentType: "SUPPORTING_DOCUMENT" });

    const invalid = await request(app).post(`/api/documents/${docs.scannedFir}/intelligence/classification/review`).set(auth("investigator")).send({ decision: "CORRECT" });
    expect(invalid.status).toBe(400);
  });

  it("corrected metadata becomes searchable and is audited by field name only", async () => {
    const res = await request(app)
      .post(`/api/documents/${docs.textFir}/intelligence/metadata/review`)
      .set(auth("investigator"))
      .send({ decision: "CORRECT", metadata: { author: "Inspector Fictional Rao", tags: ["theft", "vehicle"] } });
    expect(res.status).toBe(200);
    expect(res.body.intelligence.metadata).toMatchObject({ review: "CONFIRMED", provenance: "AI_ASSISTED" });
    expect(res.body.intelligence.metadata.confirmed.author).toEqual({ value: "Inspector Fictional Rao", confidence: 1 });

    const found = await search("investigator", { q: "Rao" });
    expect(found.body.results.map((r: any) => r.documentId)).toContain(docs.textFir);
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { documentId: docs.textFir, action: "AI_METADATA_REVIEWED" } });
    expect(audit.metadata).toMatchObject({ changedFields: ["author", "tags"] });
    expect(JSON.stringify(audit)).not.toContain("Rao");

    const bad = await request(app).post(`/api/documents/${docs.textFir}/intelligence/metadata/review`).set(auth("investigator")).send({ decision: "CORRECT", metadata: { unknownField: "x" } });
    expect(bad.status).toBe(400);
  });
});

describe("reprocessing, summaries and versions", () => {
  it("reprocess queues a new attempt, rejects duplicates while queued, and preserves human review", async () => {
    const first = await request(app).post(`/api/documents/${docs.textFir}/intelligence/reprocess`).set(auth("investigator"));
    expect(first.status).toBe(202);
    const dup = await request(app).post(`/api/documents/${docs.textFir}/intelligence/reprocess`).set(auth("investigator"));
    expect(dup.status).toBe(409);
    await drain();
    const i = (await intelligence("investigator", docs.textFir)).body.intelligence;
    expect(i.processing).toMatchObject({ status: "COMPLETED", attempts: 2 });
    expect(i.classification).toMatchObject({ review: "CONFIRMED", provenance: "HUMAN_CONFIRMED" });
    expect(i.metadata.confirmed.author.value).toBe("Inspector Fictional Rao");
    expect(i.jobs.map((j: any) => j.attempt)).toEqual([2, 1]);
    // Confirmed metadata still drives the index after reprocessing.
    expect((await search("investigator", { q: "Rao" })).body.results.map((r: any) => r.documentId)).toContain(docs.textFir);
  });

  it("regenerates a summary on demand, but never for RESTRICTED material", async () => {
    const res = await request(app).post(`/api/documents/${docs.textFir}/intelligence/summary`).set(auth("investigator"));
    expect(res.status).toBe(200);
    expect(res.body.intelligence.summary.status).toBe("COMPLETED");
    // ADMIN lacks ai.process entirely: authorization denies before the policy is consulted.
    const noPermission = await request(app).post(`/api/documents/${docs.restrictedText}/intelligence/summary`).set(auth("admin"));
    expect(noPermission.status).toBe(403);
    expect(noPermission.body.error.code).toBe("DOCUMENT_ACCESS_DENIED");

    // Even with an explicit ai.process grant on the document, policy still blocks RESTRICTED material.
    for (const key of ["ai.process", "document.view"]) {
      const permission = await prisma.permission.upsert({ where: { key }, create: { key, resource: key.split(".")[0], action: key.split(".")[1] }, update: {} });
      await prisma.documentPermission.create({ data: { documentId: docs.restrictedText, userId: actors.investigator.id, permissionId: permission.id, grantedBy: actors.admin.id } });
    }
    const restricted = await request(app).post(`/api/documents/${docs.restrictedText}/intelligence/summary`).set(auth("investigator"));
    expect(restricted.status).toBe(403);
    expect(restricted.body.error.code).toBe("AI_POLICY_BLOCKED");
    // The grant takes effect immediately for reading and search, too.
    expect((await intelligence("investigator", docs.restrictedText)).status).toBe(200);
    expect((await search("investigator", { q: "granary" })).body.results.map((r: any) => r.documentId)).toEqual([docs.restrictedText]);
  });

  it("a new version gets its own intelligence record; the earlier version's record is kept", async () => {
    const res = await request(app)
      .post(`/api/documents/${docs.scannedWitness}/versions`)
      .set(auth("forensic"))
      .field("changeNote", "Rescanned")
      .attach("file", await buildScannedPdf({ pages: [{ text: scannedWitnessText(caseNumber, "EVD-2024-00008") }] }), { filename: "witness-v2.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(201);
    await drain();
    const rows = await prisma.documentIntelligence.findMany({ where: { documentId: docs.scannedWitness }, include: { version: true }, orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => r.version.versionNumber)).toEqual([1, 2]);
    const current = (await intelligence("forensic", docs.scannedWitness)).body;
    expect(current.document.versionNumber).toBe(2);
    expect(current.intelligence.metadata.extracted.evidenceIds.value).toEqual(["EVD-2024-00008"]);
  });

  it("refuses to process a stored file whose bytes no longer match the registered hash", async () => {
    const doc = await upload("investigator", { title: "Tamper target", bytes: Buffer.from("Police report of a minor incident near the market.", "utf-8"), fileName: "t.txt", contentType: "text/plain" });
    await drain();
    const version = await prisma.documentVersion.findFirstOrThrow({ where: { documentId: doc.id } });
    await getStorageProvider().put(version.storageKey, Buffer.from("Tampered content.", "utf-8"), "text/plain");

    expect((await request(app).post(`/api/documents/${doc.id}/intelligence/reprocess`).set(auth("investigator"))).status).toBe(202);
    await drain();
    const i = (await intelligence("investigator", doc.id)).body.intelligence;
    expect(i.processing.status).toBe("FAILED");
    expect(i.processing.error).toMatch(/integrity verification failed/i);
    expect(await prisma.securityEvent.count({ where: { documentId: doc.id, type: "INTEGRITY_VIOLATION" } })).toBe(1);
    expect((await prisma.aiProcessingJob.findFirstOrThrow({ where: { documentId: doc.id }, orderBy: { createdAt: "desc" } })).status).toBe("FAILED");
  });

  it("documents in other cases are unaffected and stay invisible to the investigator", async () => {
    const doc = await upload("outsider", {
      title: "Other case FIR",
      bytes: Buffer.from(scannedFirText("CASE-2024-000001"), "utf-8"),
      fileName: "other.txt",
      contentType: "text/plain",
      targetCase: otherCaseId,
    });
    await drain();
    const res = await search("investigator", { q: "two-wheeler" });
    expect(res.body.results.map((r: any) => r.documentId)).not.toContain(doc.id);
    expect((await search("outsider", { q: "two-wheeler" })).body.results.map((r: any) => r.documentId)).toEqual([doc.id]);
  });
});
