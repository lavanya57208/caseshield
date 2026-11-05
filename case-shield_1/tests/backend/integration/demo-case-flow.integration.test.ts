import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import { createApp } from "../../../backend/src/app";
import { prisma } from "../../../backend/src/lib/prisma";
import { env } from "../../../backend/src/config/env";
import { buildFictionalContactSheetPdf } from "../../../prisma/fixtures/fictional-pii-document";

// The scripted demo flow end-to-end through the real API: create a case with
// a chosen number → edit it → upload a document → list and open it. Every
// person and case here is fictional.

const app = createApp();
const DAY = 24 * 60 * 60 * 1000;
type Actor = { id: string; token: string };
const actors: Record<string, Actor> = {};
const auth = (name: string) => ({ Authorization: `Bearer ${actors[name].token}` });

let categoryId: string;
let typeId: string;
let otherCategoryId: string;
let otherTypeId: string;
let caseId: string;
const caseNumber = `CASE-2031-${String(Math.floor(10000 + Math.random() * 89999))}`;

async function makeUser(name: string, roleKey: string, organizationId: string) {
  const role = await prisma.role.upsert({ where: { key: roleKey }, create: { key: roleKey, name: roleKey }, update: {} });
  const user = await prisma.user.create({
    data: {
      email: `demo-${name}.${uuidv4().slice(0, 8)}@example.com`,
      fullName: `Demo ${name}`,
      organizationId,
      passwordHash: "not-used-in-tests",
      userRoles: { create: { roleId: role.id } },
    },
  });
  const session = await prisma.session.create({ data: { userId: user.id, tokenHash: uuidv4(), expiresAt: new Date(Date.now() + DAY) } });
  actors[name] = { id: user.id, token: jwt.sign({ sub: user.id, sessionId: session.id }, env.JWT_SECRET, { expiresIn: "1h" }) };
}

beforeAll(async () => {
  const org = await prisma.organization.create({ data: { name: "Fictional Bureau (demo flow test)" } });
  const otherOrg = await prisma.organization.create({ data: { name: "Other Fictional Agency (demo flow test)" } });
  await makeUser("senior", "SENIOR_INVESTIGATOR", org.id);
  await makeUser("investigator", "INVESTIGATOR", org.id);
  await makeUser("lawyer", "LAWYER", org.id);
  await makeUser("foreignInvestigator", "INVESTIGATOR", otherOrg.id);

  const suffix = uuidv4().slice(0, 6);
  const criminal = await prisma.caseCategory.create({ data: { key: `DEMO_CRIM_${suffix}`, name: "Criminal Matters (demo test)" } });
  const civil = await prisma.caseCategory.create({ data: { key: `DEMO_CIV_${suffix}`, name: "Civil Matters (demo test)" } });
  categoryId = criminal.id;
  typeId = (await prisma.caseType.create({ data: { categoryId: criminal.id, key: "CRIMINAL_INVESTIGATION", name: "Criminal Investigation" } })).id;
  otherCategoryId = civil.id;
  otherTypeId = (await prisma.caseType.create({ data: { categoryId: civil.id, key: "PROPERTY_SUIT", name: "Property Suit" } })).id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

const baseCase = () => ({
  title: "State vs. Arun Kumar",
  categoryId,
  typeId,
  court: "Fictional Sessions Court",
  priority: "HIGH",
  description: "Fictional criminal investigation used for the demo flow.",
});

describe("create case", () => {
  it("suggests the next free case number and lists assignable officers (id, name, role only)", async () => {
    const next = await request(app).get("/api/cases/next-number").set(auth("senior"));
    expect(next.status).toBe(200);
    expect(next.body.caseNumber).toMatch(/^CASE-\d{4}-\d{5}$/);

    const officers = await request(app).get("/api/cases/officers").set(auth("senior"));
    expect(officers.status).toBe(200);
    const ids = officers.body.officers.map((o: any) => o.id);
    expect(ids).toEqual(expect.arrayContaining([actors.senior.id, actors.investigator.id]));
    expect(ids).not.toContain(actors.lawyer.id);
    expect(ids).not.toContain(actors.foreignInvestigator.id);
    expect(Object.keys(officers.body.officers[0]).sort()).toEqual(["department", "fullName", "id", "role"]);

    expect((await request(app).get("/api/cases/officers").set(auth("investigator"))).status).toBe(403);
  });

  it("creates a case with a chosen number, naming another officer, and keeps the creator on the case", async () => {
    const res = await request(app)
      .post("/api/cases")
      .set(auth("senior"))
      .send({ ...baseCase(), caseNumber: caseNumber.toLowerCase(), investigatingOfficerId: actors.investigator.id });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.case.caseNumber).toBe(caseNumber);
    caseId = res.body.case.id;

    // Both the named officer and the creator can open the new workspace.
    for (const who of ["senior", "investigator"]) {
      const view = await request(app).get(`/api/cases/${caseId}`).set(auth(who));
      expect(view.status, who).toBe(200);
    }
    const detail = (await request(app).get(`/api/cases/${caseId}`).set(auth("senior"))).body.case;
    expect(detail.investigatingOfficer.id).toBe(actors.investigator.id);
    expect(detail.category.id).toBe(categoryId);
    expect(detail.type.name).toBe("Criminal Investigation");
  });

  it("rejects a duplicate number, a malformed number, a mismatched type and a non-investigator officer", async () => {
    const dup = await request(app).post("/api/cases").set(auth("senior")).send({ ...baseCase(), caseNumber });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("CASE_NUMBER_TAKEN");

    expect((await request(app).post("/api/cases").set(auth("senior")).send({ ...baseCase(), caseNumber: "2026-427" })).status).toBe(400);

    const mismatch = await request(app).post("/api/cases").set(auth("senior")).send({ ...baseCase(), typeId: otherTypeId });
    expect(mismatch.body.error.code).toBe("INVALID_CASE_TYPE");

    const badOfficer = await request(app).post("/api/cases").set(auth("senior")).send({ ...baseCase(), investigatingOfficerId: actors.lawyer.id });
    expect(badOfficer.body.error.code).toBe("INVALID_OFFICER");
  });

  it("auto-assigns a number when none is given; investigators cannot create cases", async () => {
    const res = await request(app).post("/api/cases").set(auth("senior")).send({ ...baseCase(), title: "Auto-numbered fictional case" });
    expect(res.status).toBe(201);
    expect(res.body.case.caseNumber).toMatch(/^CASE-\d{4}-\d{5}$/);
    expect((await request(app).post("/api/cases").set(auth("investigator")).send(baseCase())).status).toBe(403);
  });
});

describe("edit case", () => {
  it("persists edits (priority, description, status, category/type) and audits field names only", async () => {
    const res = await request(app)
      .patch(`/api/cases/${caseId}`)
      .set(auth("senior"))
      .send({ priority: "CRITICAL", description: "Updated fictional description.", status: "UNDER_REVIEW", categoryId: otherCategoryId, typeId: otherTypeId });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const detail = (await request(app).get(`/api/cases/${caseId}`).set(auth("senior"))).body.case;
    expect(detail).toMatchObject({ priority: "CRITICAL", description: "Updated fictional description.", status: "UNDER_REVIEW" });
    expect(detail.type.id).toBe(otherTypeId);

    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { caseId, action: "CASE_UPDATED", result: "SUCCESS" } });
    expect((audit.metadata as any).changedFields.sort()).toEqual(["categoryId", "description", "priority", "status", "typeId"]);
    expect(JSON.stringify(audit)).not.toContain("Updated fictional description");
  });

  it("validates type/category and the officer; reassigning the officer adds them to the case team", async () => {
    expect((await request(app).patch(`/api/cases/${caseId}`).set(auth("senior")).send({ typeId })).body.error.code).toBe("INVALID_CASE_TYPE");
    expect((await request(app).patch(`/api/cases/${caseId}`).set(auth("senior")).send({ categoryId })).status).toBe(400);
    expect((await request(app).patch(`/api/cases/${caseId}`).set(auth("senior")).send({ caseNumber: "CASE-2031-00001" })).status).toBe(400);

    const res = await request(app).patch(`/api/cases/${caseId}`).set(auth("senior")).send({ investigatingOfficerId: actors.senior.id });
    expect(res.status).toBe(200);
    const assignment = await prisma.caseAssignment.findUniqueOrThrow({ where: { caseId_userId: { caseId, userId: actors.senior.id } } });
    expect(assignment.roleOnCase).toBe("INVESTIGATING_OFFICER");
  });

  it("requires case.update: an assigned investigator cannot edit, and the denial is audited", async () => {
    const res = await request(app).patch(`/api/cases/${caseId}`).set(auth("investigator")).send({ priority: "LOW" });
    expect(res.status).toBe(403);
    expect((await prisma.case.findUniqueOrThrow({ where: { id: caseId } })).priority).toBe("CRITICAL");
    expect(await prisma.auditEvent.count({ where: { caseId, action: "CASE_UPDATED", result: "DENIED" } })).toBe(1);
    expect((await request(app).patch(`/api/cases/${caseId}`).set(auth("foreignInvestigator")).send({ priority: "LOW" })).status).toBe(403);
  });
});

describe("upload → list → open", () => {
  let documentId: string;

  it("uploads a document into the new case and lists it with version, integrity and uploader", async () => {
    const pdf = await buildFictionalContactSheetPdf(caseNumber);
    const up = await request(app)
      .post("/api/documents")
      .set(auth("senior"))
      .field("caseId", caseId)
      .field("type", "FORENSIC_REPORT")
      .field("title", "Forensic_Report.pdf")
      .field("confidentiality", "CONFIDENTIAL")
      .attach("file", pdf, { filename: "Forensic_Report.pdf", contentType: "application/pdf" });
    expect(up.status).toBe(201);
    expect(up.body.document.currentVersion.sha256Hash).toMatch(/^[0-9a-f]{64}$/);
    documentId = up.body.document.id;

    const list = await request(app).get("/api/documents").set(auth("senior")).query({ caseId });
    expect(list.status).toBe(200);
    const row = list.body.items.find((d: any) => d.id === documentId);
    expect(row).toMatchObject({ title: "Forensic_Report.pdf", type: "FORENSIC_REPORT" });
    expect(row.versions[0]).toMatchObject({ versionNumber: 1, integrityStatus: "VERIFIED", uploader: { fullName: "Demo senior" } });
  });

  it("opens the document with its case, uploader and hash, and verifies integrity", async () => {
    const res = await request(app).get(`/api/documents/${documentId}`).set(auth("senior"));
    expect(res.status).toBe(200);
    expect(res.body.document.case.caseNumber).toBe(caseNumber);
    expect(res.body.document.versions[0].uploader.fullName).toBe("Demo senior");
    const verify = await request(app).post(`/api/documents/${documentId}/verify`).set(auth("senior"));
    expect(verify.body.status).toBe("VERIFIED");
  });

  it("dashboard reports document and pending-action counts for the caller's cases", async () => {
    const res = await request(app).get("/api/dashboard").set(auth("senior"));
    expect(res.status).toBe(200);
    expect(res.body.documentCount).toBeGreaterThanOrEqual(1);
    expect(typeof res.body.pendingActions).toBe("number");
    expect(res.body.recentCases.find((c: any) => c.id === caseId)?.type?.name).toBe("Property Suit");
  });
});
