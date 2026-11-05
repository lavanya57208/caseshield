import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import { createApp } from "../../../backend/src/app";
import { prisma } from "../../../backend/src/lib/prisma";
import { env } from "../../../backend/src/config/env";
import { sha256 } from "../../../backend/src/lib/hash";
import { getStorageProvider } from "../../../backend/src/modules/storage";
import { buildFictionalContactSheetPdf } from "../../../prisma/fixtures/fictional-pii-document";

// End-to-end tests of Phase 3 (evidence, chain of custody, scoped audit)
// through the real Express app and the isolated PostgreSQL test database.
// Every person, case and item is fictional.

const app = createApp();
const DAY = 24 * 60 * 60 * 1000;

type Actor = { id: string; token: string };
const actors: Record<string, Actor> = {};
let orgId: string;
let caseId: string;
let otherCaseId: string;
let docId: string;
let tamperDocId: string;
let originalBytes: Buffer;
let evidenceId: string; // main workflow item (digital)
let physicalId: string; // no attached file
let tamperEvidenceId: string; // used for tamper-detection tests

const auth = (name: string) => ({ Authorization: `Bearer ${actors[name].token}` });

async function makeUser(name: string, roleKey: string, organizationId: string, status: "ACTIVE" | "SUSPENDED" = "ACTIVE") {
  const role = await prisma.role.upsert({ where: { key: roleKey }, create: { key: roleKey, name: roleKey }, update: {} });
  const user = await prisma.user.create({
    data: {
      email: `p3-${name}.${uuidv4().slice(0, 8)}@example.com`,
      fullName: `Test ${name}`,
      organizationId,
      passwordHash: "not-used-in-tests",
      status,
      userRoles: { create: { roleId: role.id } },
    },
  });
  const session = await prisma.session.create({ data: { userId: user.id, tokenHash: uuidv4(), expiresAt: new Date(Date.now() + DAY) } });
  actors[name] = { id: user.id, token: jwt.sign({ sub: user.id, sessionId: session.id }, env.JWT_SECRET, { expiresIn: "1h" }) };
}

const auditRows = (where: Record<string, unknown>) => prisma.auditEvent.findMany({ where, orderBy: { occurredAt: "asc" } });
const events = (id: string) => prisma.custodyEvent.findMany({ where: { evidenceId: id }, orderBy: { sequence: "asc" } });

async function uploadDoc(title: string, bytes: Buffer) {
  const res = await request(app)
    .post("/api/documents")
    .set(auth("investigator"))
    .field("caseId", caseId)
    .field("type", "FORENSIC_REPORT")
    .field("title", title)
    .field("confidentiality", "CONFIDENTIAL")
    .attach("file", bytes, { filename: title, contentType: "application/pdf" });
  expect(res.status).toBe(201);
  return res.body.document.id as string;
}

async function register(as: string, body: Record<string, unknown>) {
  return request(app)
    .post("/api/evidence")
    .set(auth(as))
    .send({
      caseId,
      title: "Forensic Examination Report",
      type: "FORENSIC_REPORT",
      description: "Fictional forensic examination report",
      source: "Forensic Laboratory",
      collectedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      confidentiality: "CONFIDENTIAL",
      ...body,
    });
}

beforeAll(async () => {
  const org = await prisma.organization.create({ data: { name: "Fictional Bureau (phase 3 test)" } });
  const otherOrg = await prisma.organization.create({ data: { name: "Other Fictional Agency (phase 3 test)" } });
  orgId = org.id;
  await makeUser("investigator", "INVESTIGATOR", org.id);
  await makeUser("senior", "SENIOR_INVESTIGATOR", org.id);
  await makeUser("forensic", "FORENSIC_OFFICER", org.id);
  await makeUser("prosecutor", "PROSECUTOR", org.id);
  await makeUser("judge", "JUDGE", org.id);
  await makeUser("auditor", "AUDITOR", org.id);
  await makeUser("lawyer", "LAWYER", org.id);
  await makeUser("outsider", "INVESTIGATOR", org.id); // same org, not on the case
  await makeUser("suspended", "FORENSIC_OFFICER", org.id, "SUSPENDED");
  await makeUser("foreignForensic", "FORENSIC_OFFICER", otherOrg.id);
  await makeUser("foreignAuditor", "AUDITOR", otherOrg.id);

  const category = await prisma.caseCategory.create({ data: { key: `P3_${uuidv4().slice(0, 6)}`, name: "Criminal (phase 3 test)" } });
  const type = await prisma.caseType.create({ data: { categoryId: category.id, key: "CYBERCRIME", name: "Cybercrime" } });
  const members = ["investigator", "senior", "forensic", "prosecutor", "suspended"];
  const c = await prisma.case.create({
    data: {
      caseNumber: `CASE-2026-P${uuidv4().slice(0, 5)}`,
      title: "Fictional phase 3 case",
      categoryId: category.id,
      typeId: type.id,
      court: "Fictional Court",
      jurisdiction: "Fictional District",
      organizationId: org.id,
      investigatingOfficerId: actors.investigator.id,
      description: "Synthetic case for automated tests.",
      createdBy: actors.investigator.id,
      assignments: { create: members.map((m) => ({ userId: actors[m].id, roleOnCase: m.toUpperCase(), assignedBy: actors.investigator.id })) },
    },
  });
  caseId = c.id;
  const other = await prisma.case.create({
    data: {
      caseNumber: `CASE-2026-Q${uuidv4().slice(0, 5)}`,
      title: "Fictional unrelated case",
      categoryId: category.id,
      typeId: type.id,
      court: "Fictional Court",
      jurisdiction: "Fictional District",
      organizationId: org.id,
      investigatingOfficerId: actors.outsider.id,
      description: "Synthetic case the senior investigator is not assigned to.",
      createdBy: actors.outsider.id,
    },
  });
  otherCaseId = other.id;
  await prisma.auditEvent.create({
    data: { actorId: actors.outsider.id, action: "CASE_VIEWED", resource: `case:${other.id}`, caseId: other.id, organizationId: org.id, requestId: "test" },
  });

  originalBytes = await buildFictionalContactSheetPdf(c.caseNumber);
  docId = await uploadDoc("Forensic_Report.pdf", originalBytes);
  tamperDocId = await uploadDoc("Tamper_Fixture.pdf", await buildFictionalContactSheetPdf(`${c.caseNumber}-T`));
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("evidence registration", () => {
  it("registers digital evidence: hashes the stored bytes, assigns custodian, creates the first custody event and an audit event", async () => {
    const res = await register("investigator", { documentId: docId, actorId: actors.senior.id, status: "ARCHIVED" });
    expect(res.status).toBe(201);
    const e = res.body.evidence;
    evidenceId = e.id;
    expect(e.evidenceNumber).toMatch(/^EVD-\d{4}-\d{5}$/);
    expect(e.status).toBe("REGISTERED"); // client-sent status ignored
    expect(e.currentCustodian.id).toBe(actors.investigator.id);
    expect(e.registeredBy.id).toBe(actors.investigator.id); // actor from token, not body
    expect(e.originalHash).toBe(sha256(originalBytes));
    expect(e.integrityStatus).toBe("VERIFIED");
    expect(e.originalDocument.id).toBe(docId);

    const [first, ...rest] = await events(evidenceId);
    expect(rest).toHaveLength(0);
    expect(first.action).toBe("REGISTERED");
    expect(first.sequence).toBe(1);
    expect(first.previousEventHash).toBeNull();
    expect(first.eventHash).toMatch(/^[0-9a-f]{64}$/);
    expect(first.actorId).toBe(actors.investigator.id);
    expect(first.hashAtEvent).toBe(sha256(originalBytes));

    const [auditEvent] = await auditRows({ evidenceId, action: "EVIDENCE_REGISTERED" });
    expect(auditEvent.result).toBe("SUCCESS");
    expect(auditEvent.organizationId).toBe(orgId);
    expect(auditEvent.caseId).toBe(caseId);
  });

  it("registers physical evidence without a file (metadata only) and with a chosen initial custodian", async () => {
    const res = await register("investigator", {
      title: "Seized handset",
      type: "DEVICE",
      description: "Fictional handset in a sealed bag",
      initialCustodianId: actors.forensic.id,
      collectedById: actors.senior.id,
    });
    expect(res.status).toBe(201);
    physicalId = res.body.evidence.id;
    expect(res.body.evidence.originalHash).toBeNull();
    expect(res.body.evidence.currentCustodian.id).toBe(actors.forensic.id);
    expect(res.body.evidence.collectedBy.id).toBe(actors.senior.id);
    const note = await prisma.notification.findFirst({ where: { userId: actors.forensic.id, relatedEvidenceId: physicalId } });
    expect(note).not.toBeNull();
  });

  it("rejects registration by users without case access or without evidence.register, and invalid input", async () => {
    expect((await register("outsider", {})).status).toBe(403);
    expect((await register("judge", {})).status).toBe(403);
    expect((await register("investigator", { type: "SPACESHIP" })).status).toBe(400);
    expect((await register("investigator", { title: "" })).status).toBe(400);
    expect((await register("investigator", { initialCustodianId: actors.suspended.id })).status).toBe(400);
    expect((await register("investigator", { initialCustodianId: actors.foreignForensic.id })).status).toBe(400);
    expect((await auditRows({ actorId: actors.outsider.id, action: "EVIDENCE_REGISTERED", result: "DENIED" })).length).toBe(1);
  });

  it("registers a second digital item used for tamper tests", async () => {
    const res = await register("investigator", { title: "Tamper fixture", documentId: tamperDocId });
    expect(res.status).toBe(201);
    tamperEvidenceId = res.body.evidence.id;
  });
});

describe("evidence access control", () => {
  it("denies users outside the case (same org), audits the denial, and hides cross-tenant evidence", async () => {
    const res = await request(app).get(`/api/evidence/${evidenceId}`).set(auth("outsider"));
    expect(res.status).toBe(403);
    expect((await auditRows({ evidenceId, actorId: actors.outsider.id, action: "EVIDENCE_VIEWED", result: "DENIED" })).length).toBe(1);
    expect((await request(app).get(`/api/evidence/${evidenceId}`).set(auth("foreignForensic"))).status).toBe(404);
    expect((await request(app).get(`/api/evidence/${evidenceId}`).set(auth("lawyer"))).status).toBe(403);
    expect((await request(app).get("/api/evidence").query({ caseId }).set(auth("outsider"))).status).toBe(403);
  });

  it("lets an authorized case member view evidence, logging the access once per window", async () => {
    const before = (await events(evidenceId)).length;
    const res = await request(app).get(`/api/evidence/${evidenceId}`).set(auth("senior"));
    expect(res.status).toBe(200);
    expect(res.body.evidence.allowedActions).toContain("VIEW");
    expect(res.body.evidence.allowedActions).not.toContain("TRANSFER"); // not the custodian
    await request(app).get(`/api/evidence/${evidenceId}`).set(auth("senior"));
    const after = await events(evidenceId);
    expect(after.length).toBe(before + 1);
    expect(after[after.length - 1].action).toBe("VIEWED");
    expect((await auditRows({ evidenceId, actorId: actors.senior.id, action: "EVIDENCE_VIEWED", result: "SUCCESS" })).length).toBe(2);
  });

  it("hides evidence from a Judge until it is submitted to court", async () => {
    expect((await request(app).get(`/api/evidence/${evidenceId}`).set(auth("judge"))).status).toBe(403);
    const list = await request(app).get("/api/evidence").query({ caseId }).set(auth("judge"));
    expect(list.status).toBe(200);
    expect(list.body.items.map((i: any) => i.id)).not.toContain(evidenceId);
  });
});

describe("custody transfer", () => {
  const transfer = (as: string, body: Record<string, unknown>, id = evidenceId) =>
    request(app).post(`/api/evidence/${id}/transfers`).set(auth(as)).send(body);

  it("rejects a transfer initiated by someone who is not the custodian, and audits it", async () => {
    const res = await transfer("senior", { toUserId: actors.forensic.id, reason: "Forensic examination" });
    expect(res.status).toBe(403);
    expect((await auditRows({ evidenceId, actorId: actors.senior.id, action: "EVIDENCE_TRANSFER_INITIATED", result: "DENIED" })).length).toBe(1);
  });

  it.each([
    ["the same custodian", "investigator", "TRANSFER_SAME_CUSTODIAN"],
    ["an inactive user", "suspended", "TRANSFER_RECIPIENT_INACTIVE"],
    ["another organization", "foreignForensic", "TRANSFER_RECIPIENT_OTHER_ORGANIZATION"],
    ["a user outside the case", "outsider", "TRANSFER_RECIPIENT_NO_CASE_ACCESS"],
    ["a role that cannot hold evidence", "judge", "TRANSFER_RECIPIENT_NOT_AUTHORIZED"],
  ])("rejects a transfer to %s", async (_label, recipient, code) => {
    const res = await transfer("investigator", { toUserId: actors[recipient].id, reason: "Forensic examination" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(code);
  });

  it("rejects a transfer without a reason", async () => {
    expect((await transfer("investigator", { toUserId: actors.forensic.id })).status).toBe(400);
    expect((await transfer("investigator", { toUserId: actors.forensic.id, reason: " " })).status).toBe(400);
  });

  it("initiates a transfer: status pending, custodian unchanged, event + audit + recipient notification", async () => {
    const res = await transfer("investigator", { toUserId: actors.forensic.id, reason: "Forensic examination", occurredAt: "2000-01-01T00:00:00Z" });
    expect(res.status).toBe(201);
    const e = res.body.evidence;
    expect(e.status).toBe("TRANSFERRED");
    expect(e.currentCustodian.id).toBe(actors.investigator.id);
    expect(e.pendingTransfer.toCustodian.id).toBe(actors.forensic.id);

    const last = (await events(evidenceId)).at(-1)!;
    expect(last.action).toBe("TRANSFERRED");
    expect(last.fromUserId).toBe(actors.investigator.id);
    expect(last.toUserId).toBe(actors.forensic.id);
    expect(Math.abs(last.occurredAt.getTime() - Date.now())).toBeLessThan(60_000); // server timestamp, not client's

    expect((await auditRows({ evidenceId, action: "EVIDENCE_TRANSFER_INITIATED", result: "SUCCESS" })).length).toBe(1);
    const note = await prisma.notification.findFirst({ where: { userId: actors.forensic.id, relatedEvidenceId: evidenceId, type: "EVIDENCE_TRANSFERRED" } });
    expect(note?.title).toBe("Evidence Transfer Request");

    const incoming = await request(app).get("/api/evidence/transfers/incoming").set(auth("forensic"));
    expect(incoming.body.transfers.map((t: any) => t.evidence.id)).toContain(evidenceId);
  });

  it("blocks a second transfer while one is pending and blocks acceptance by anyone but the recipient", async () => {
    expect((await transfer("investigator", { toUserId: actors.senior.id, reason: "Second transfer" })).status).toBe(409);
    const pending = await prisma.evidenceTransfer.findFirstOrThrow({ where: { evidenceId, status: "PENDING" } });
    const res = await request(app).post(`/api/evidence/${evidenceId}/transfers/${pending.id}/accept`).set(auth("senior")).send({});
    expect(res.status).toBe(403);
  });

  it("lets the recipient accept: custody becomes active, previous custodian is notified", async () => {
    const pending = await prisma.evidenceTransfer.findFirstOrThrow({ where: { evidenceId, status: "PENDING" } });
    const res = await request(app).post(`/api/evidence/${evidenceId}/transfers/${pending.id}/accept`).set(auth("forensic")).send({ notes: "Seal intact." });
    expect(res.status).toBe(200);
    expect(res.body.evidence.status).toBe("IN_CUSTODY");
    expect(res.body.evidence.currentCustodian.id).toBe(actors.forensic.id);
    expect(res.body.evidence.pendingTransfer).toBeNull();

    const last = (await events(evidenceId)).at(-1)!;
    expect(last.action).toBe("RECEIVED");
    expect(last.actorId).toBe(actors.forensic.id);
    expect(last.transferId).toBe(pending.id);
    expect((await auditRows({ evidenceId, action: "EVIDENCE_TRANSFER_ACCEPTED", result: "SUCCESS" })).length).toBe(1);
    expect(await prisma.notification.findFirst({ where: { userId: actors.investigator.id, relatedEvidenceId: evidenceId, type: "CUSTODY_ACKNOWLEDGED" } })).not.toBeNull();

    // A consumed transfer cannot be accepted twice.
    expect((await request(app).post(`/api/evidence/${evidenceId}/transfers/${pending.id}/accept`).set(auth("forensic")).send({})).status).toBe(409);
  });

  it("enforces custodian-only actions and lifecycle transitions", async () => {
    const act = (as: string, action: string) => request(app).post(`/api/evidence/${evidenceId}/actions`).set(auth(as)).send({ action, reason: "Recorded by test" });
    expect((await act("investigator", "SEALED")).status).toBe(403); // no longer custodian
    expect((await act("forensic", "RETURNED")).status).toBe(409); // never submitted
    expect((await act("forensic", "UNDER_EXAMINATION")).status).toBe(400); // statuses are not actions
    const examined = await act("forensic", "EXAMINED");
    expect(examined.status).toBe(200);
    expect(examined.body.evidence.status).toBe("UNDER_EXAMINATION");
    expect((await auditRows({ evidenceId, action: "EVIDENCE_EXAMINED" })).length).toBe(1);
    expect((await auditRows({ evidenceId, action: "EVIDENCE_RETURNED", result: "DENIED" })).length).toBe(1);
  });

  it("restores the previous state when the recipient rejects a transfer", async () => {
    await transfer("forensic", { toUserId: actors.prosecutor.id, reason: "Prosecution review" });
    const pending = await prisma.evidenceTransfer.findFirstOrThrow({ where: { evidenceId, status: "PENDING" } });
    const res = await request(app).post(`/api/evidence/${evidenceId}/transfers/${pending.id}/reject`).set(auth("prosecutor")).send({ reason: "Not yet required" });
    expect(res.status).toBe(200);
    expect(res.body.evidence.status).toBe("UNDER_EXAMINATION");
    expect(res.body.evidence.currentCustodian.id).toBe(actors.forensic.id);
    expect((await events(evidenceId)).at(-1)!.action).toBe("TRANSFER_REJECTED");
    expect((await auditRows({ evidenceId, action: "EVIDENCE_TRANSFER_REJECTED" })).length).toBe(1);
  });

  it("completes forensic -> prosecutor -> court, after which the Judge can view it", async () => {
    await transfer("forensic", { toUserId: actors.prosecutor.id, reason: "Prosecution review" });
    const pending = await prisma.evidenceTransfer.findFirstOrThrow({ where: { evidenceId, status: "PENDING" } });
    await request(app).post(`/api/evidence/${evidenceId}/transfers/${pending.id}/accept`).set(auth("prosecutor")).send({});
    const submit = await request(app).post(`/api/evidence/${evidenceId}/actions`).set(auth("prosecutor")).send({ action: "SUBMITTED", reason: "Filed with the court" });
    expect(submit.status).toBe(200);
    expect(submit.body.evidence.status).toBe("SUBMITTED_TO_COURT");
    expect((await request(app).get(`/api/evidence/${evidenceId}`).set(auth("judge"))).status).toBe(200);
  });
});

describe("integrity verification", () => {
  it("verifies unchanged evidence and never modifies the original document", async () => {
    const res = await request(app).post(`/api/evidence/${evidenceId}/verify-integrity`).set(auth("prosecutor"));
    expect(res.status).toBe(200);
    expect(res.body.label).toBe("INTEGRITY VERIFIED");
    expect(res.body.currentHash).toBe(res.body.registeredHash);
    expect(res.body.message).not.toMatch(/tamper-proof|legally admissible|guarantee/i);

    const version = await prisma.documentVersion.findFirstOrThrow({ where: { documentId: docId } });
    const stored = await getStorageProvider().get(version.storageKey);
    expect(Buffer.compare(stored, originalBytes)).toBe(0); // original bytes unchanged after the whole workflow
    expect(version.sha256Hash).toBe(sha256(originalBytes));
    expect((await auditRows({ evidenceId, action: "EVIDENCE_VERIFIED", result: "SUCCESS" })).length).toBe(1);
    expect((await events(evidenceId)).at(-1)!.action).toBe("VERIFIED");
  });

  it("detects a tampered stored document", async () => {
    const e = await prisma.evidence.findUniqueOrThrow({ where: { id: tamperEvidenceId }, include: { originalVersion: true } });
    await getStorageProvider().put(e.originalVersion!.storageKey, Buffer.from("%PDF-1.4 tampered fictional bytes"), "application/pdf");
    const res = await request(app).post(`/api/evidence/${tamperEvidenceId}/verify-integrity`).set(auth("investigator"));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("VIOLATION");
    expect(res.body.label).toBe("INTEGRITY VIOLATION");
    expect(res.body.currentHash).not.toBe(res.body.registeredHash);
    const row = await prisma.evidence.findUniqueOrThrow({ where: { id: tamperEvidenceId } });
    expect(row.integrityStatus).toBe("VIOLATION");
    expect(row.originalHash).toBe(e.originalHash); // registered hash is never overwritten
    expect((await auditRows({ evidenceId: tamperEvidenceId, action: "EVIDENCE_VERIFIED", result: "ERROR" })).length).toBe(1);
    expect(await prisma.securityEvent.findFirst({ where: { caseId, type: "INTEGRITY_VIOLATION" } })).not.toBeNull();
  });

  it("reports that physical evidence has no bytes to hash", async () => {
    expect((await request(app).post(`/api/evidence/${physicalId}/verify-integrity`).set(auth("forensic"))).status).toBe(409);
  });

  it("denies verification to users without evidence.verify / case access", async () => {
    expect((await request(app).post(`/api/evidence/${evidenceId}/verify-integrity`).set(auth("outsider"))).status).toBe(403);
  });
});

describe("custody chain verification", () => {
  it("stores a correctly hash-linked chain and verifies it", async () => {
    const chain = await events(evidenceId);
    expect(chain.length).toBeGreaterThan(8);
    chain.forEach((ev, i) => {
      expect(ev.sequence).toBe(i + 1);
      expect(ev.previousEventHash).toBe(i === 0 ? null : chain[i - 1].eventHash);
    });
    const row = await prisma.evidence.findUniqueOrThrow({ where: { id: evidenceId } });
    expect(row.custodyHeadHash).toBe(chain.at(-1)!.eventHash);
    expect(row.custodyEventCount).toBe(chain.length);

    const res = await request(app).post(`/api/evidence/${evidenceId}/verify-custody`).set(auth("auditor"));
    expect(res.status).toBe(200);
    expect(res.body.label).toBe("CUSTODY CHAIN VERIFIED");
    expect(res.body.eventsChecked).toBe(chain.length);
    expect((await auditRows({ evidenceId, action: "CUSTODY_CHAIN_VERIFIED" })).length).toBe(1);
  });

  it("detects an edited custody event, reporting the failing event with expected and stored hash", async () => {
    const [, second] = await events(tamperEvidenceId);
    await prisma.custodyEvent.update({ where: { id: second.id }, data: { reason: "Rewritten after the fact" } });
    const res = await request(app).post(`/api/evidence/${tamperEvidenceId}/verify-custody`).set(auth("investigator"));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("VIOLATION");
    expect(res.body.label).toBe("CUSTODY CHAIN INTEGRITY VIOLATION");
    const failure = res.body.failures.find((f: any) => f.code === "HASH_MISMATCH");
    expect(failure.sequence).toBe(2);
    expect(failure.storedHash).toBe(second.eventHash);
    expect(failure.expectedHash).not.toBe(second.eventHash);
    expect(JSON.stringify(res.body)).not.toContain("Rewritten after the fact"); // no event content echoed
    expect((await auditRows({ evidenceId: tamperEvidenceId, action: "CUSTODY_CHAIN_INTEGRITY_FAILED", result: "ERROR" })).length).toBe(1);
  });

  it("detects a deleted trailing custody event (truncation)", async () => {
    const chain = await events(physicalId);
    // Add one more event through the API, then delete it directly.
    await request(app).get(`/api/evidence/${physicalId}`).set(auth("forensic"));
    const latest = (await events(physicalId)).at(-1)!;
    expect(latest.sequence).toBe(chain.length + 1);
    await prisma.custodyEvent.delete({ where: { id: latest.id } });
    const res = await request(app).post(`/api/evidence/${physicalId}/verify-custody`).set(auth("forensic"));
    expect(res.body.status).toBe("VIOLATION");
    expect(res.body.failures.map((f: any) => f.code)).toContain("HEAD_MISMATCH");
  });
});

describe("scoped audit trail", () => {
  it("returns only in-scope events for a Senior Investigator and filters by evidence/action", async () => {
    const all = await request(app).get("/api/audit").query({ pageSize: 100 }).set(auth("senior"));
    expect(all.status).toBe(200);
    expect(all.body.items.every((i: any) => i.caseId === caseId)).toBe(true);

    const byEvidence = await request(app).get("/api/audit").query({ evidenceId, action: "EVIDENCE_TRANSFER_ACCEPTED", result: "SUCCESS" }).set(auth("senior"));
    expect(byEvidence.status).toBe(200);
    expect(byEvidence.body.items.length).toBe(2);
    expect(byEvidence.body.items.every((i: any) => i.evidence.evidenceNumber && i.action === "EVIDENCE_TRANSFER_ACCEPTED")).toBe(true);

    const byResult = await request(app).get("/api/audit").query({ caseId, result: "DENIED", pageSize: 100 }).set(auth("senior"));
    expect(byResult.body.items.length).toBeGreaterThan(0);
    expect(byResult.body.items.every((i: any) => i.result === "DENIED")).toBe(true);

    const future = await request(app).get("/api/audit").query({ caseId, from: new Date(Date.now() + DAY).toISOString() }).set(auth("senior"));
    expect(future.body.total).toBe(0);
  });

  it("refuses audit queries for cases the user cannot access, and audits the refusal", async () => {
    const res = await request(app).get("/api/audit").query({ caseId: otherCaseId }).set(auth("senior"));
    expect(res.status).toBe(403);
    expect((await auditRows({ actorId: actors.senior.id, action: "AUDIT_QUERY_DENIED" })).length).toBe(1);
    expect((await request(app).get("/api/audit").set(auth("investigator"))).status).toBe(403); // no audit.view
    expect((await request(app).get("/api/audit").query({ evidenceId }).set(auth("investigator"))).status).toBe(403);
    expect((await request(app).get("/api/audit").query({ caseId }).set(auth("foreignAuditor"))).status).toBe(403);
  });

  it("gives Auditors organization-wide scope, but never another organization's data", async () => {
    const res = await request(app).get("/api/audit").query({ caseId: otherCaseId }).set(auth("auditor"));
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);
    expect((await request(app).get("/api/audit").query({ organizationId: uuidv4() }).set(auth("auditor"))).status).toBe(403);
    const foreign = await request(app).get("/api/audit").query({ pageSize: 100 }).set(auth("foreignAuditor"));
    expect(foreign.status).toBe(200);
    expect(foreign.body.items.some((i: any) => i.caseId === caseId)).toBe(false);
  });

  it("exposes filter facets limited to the same scope", async () => {
    const res = await request(app).get("/api/audit/facets").set(auth("senior"));
    expect(res.status).toBe(200);
    expect(res.body.cases.map((c: any) => c.id)).toEqual([caseId]);
    expect(res.body.actions).toContain("EVIDENCE_REGISTERED");
    expect(res.body.evidence.map((e: any) => e.id)).toContain(evidenceId);
    expect((await request(app).get("/api/audit/facets").query({ caseId: otherCaseId }).set(auth("senior"))).status).toBe(403);
  });
});
