import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import { createApp } from "../../../backend/src/app";
import { prisma } from "../../../backend/src/lib/prisma";
import { env } from "../../../backend/src/config/env";
import { sha256 } from "../../../backend/src/lib/hash";
import { getStorageProvider } from "../../../backend/src/modules/storage";
import { extractPdfPlainText } from "../../../backend/src/modules/privacy/processing/pdf.processor";
import { buildFictionalContactSheetPdf, FICTIONAL_PII, RAW_PII_VALUES } from "../../../prisma/fixtures/fictional-pii-document";

// End-to-end tests of Phase 2 through the real Express app and an isolated
// PostgreSQL test database (see backend/vitest.config.ts and
// tests/backend/setup/global-setup.ts). Every person and value is fictional.

const app = createApp();
const DAY = 24 * 60 * 60 * 1000;
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

type Actor = { id: string; token: string };
const actors: Record<string, Actor> = {};
let caseId: string;
let pdfDocId: string;
let pngDocId: string;
let redactedDerivativeId: string;

function auth(name: string) {
  return { Authorization: `Bearer ${actors[name].token}` };
}

function binaryParser(res: any, callback: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on("data", (c: Buffer) => chunks.push(c));
  res.on("end", () => callback(null, Buffer.concat(chunks)));
}

async function makeUser(name: string, roleKey: string, organizationId: string) {
  const role = await prisma.role.upsert({ where: { key: roleKey }, create: { key: roleKey, name: roleKey }, update: {} });
  const user = await prisma.user.create({
    data: {
      email: `${name}.${uuidv4().slice(0, 8)}@example.com`,
      fullName: `Test ${name}`,
      organizationId,
      passwordHash: "not-used-in-tests",
      userRoles: { create: { roleId: role.id } },
    },
  });
  const session = await prisma.session.create({
    data: { userId: user.id, tokenHash: uuidv4(), expiresAt: new Date(Date.now() + DAY) },
  });
  actors[name] = { id: user.id, token: jwt.sign({ sub: user.id, sessionId: session.id }, env.JWT_SECRET, { expiresIn: "1h" }) };
}

async function auditRows(where: Record<string, unknown>) {
  return prisma.auditEvent.findMany({ where, orderBy: { occurredAt: "asc" } });
}

async function createShare(body: Record<string, unknown>, as = "senior") {
  return request(app)
    .post("/api/shares")
    .set(auth(as))
    .send({
      documentId: pdfDocId,
      recipientUserId: actors.prosecutor.id,
      recipientOrganization: "Prosecutor Office",
      purpose: "COURT_FILING",
      expiresAt: new Date(Date.now() + 5 * DAY).toISOString(),
      ...body,
    });
}

beforeAll(async () => {
  const org = await prisma.organization.create({ data: { name: "Fictional Bureau (test)" } });
  const otherOrg = await prisma.organization.create({ data: { name: "Other Fictional Agency (test)" } });
  await makeUser("investigator", "INVESTIGATOR", org.id);
  await makeUser("senior", "SENIOR_INVESTIGATOR", org.id);
  await makeUser("admin", "ADMIN", org.id);
  await makeUser("prosecutor", "PROSECUTOR", org.id);
  await makeUser("lawyer", "LAWYER", org.id);
  await makeUser("outsider", "PROSECUTOR", otherOrg.id);

  const category = await prisma.caseCategory.create({ data: { key: `CRIMINAL_${uuidv4().slice(0, 6)}`, name: "Criminal (test)" } });
  const type = await prisma.caseType.create({ data: { categoryId: category.id, key: "CYBERCRIME", name: "Cybercrime" } });
  const c = await prisma.case.create({
    data: {
      caseNumber: `CASE-2026-T${uuidv4().slice(0, 5)}`,
      title: "Fictional integration-test case",
      categoryId: category.id,
      typeId: type.id,
      court: "Fictional Court",
      jurisdiction: "Fictional District",
      organizationId: org.id,
      investigatingOfficerId: actors.investigator.id,
      description: "Synthetic case for automated tests.",
      createdBy: actors.investigator.id,
      assignments: {
        create: [
          { userId: actors.investigator.id, roleOnCase: "INVESTIGATING_OFFICER", assignedBy: actors.investigator.id },
          { userId: actors.senior.id, roleOnCase: "SUPERVISING_OFFICER", assignedBy: actors.investigator.id },
        ],
      },
    },
  });
  caseId = c.id;

  const pdf = await buildFictionalContactSheetPdf(c.caseNumber);
  const upload = await request(app)
    .post("/api/documents")
    .set(auth("investigator"))
    .field("caseId", caseId)
    .field("type", "WITNESS_STATEMENT")
    .field("title", "Complainant_Contact_Sheet.pdf")
    .field("confidentiality", "CONFIDENTIAL")
    .attach("file", pdf, { filename: "Complainant_Contact_Sheet.pdf", contentType: "application/pdf" });
  expect(upload.status).toBe(201);
  pdfDocId = upload.body.document.id;

  const png = await request(app)
    .post("/api/documents")
    .set(auth("investigator"))
    .field("caseId", caseId)
    .field("type", "EVIDENCE_RECORD")
    .field("title", "Scene_Photo.png")
    .attach("file", PNG_BYTES, { filename: "Scene_Photo.png", contentType: "image/png" });
  expect(png.status).toBe(201);
  pngDocId = png.body.document.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("PII scanning", () => {
  it("rejects a scan by a user without access to the case, and audits the denial", async () => {
    const res = await request(app).post(`/api/documents/${pdfDocId}/pii-scans`).set(auth("lawyer")).send({});
    expect(res.status).toBe(403);
    const denied = await auditRows({ documentId: pdfDocId, action: "PII_SCAN_STARTED", result: "DENIED" });
    expect(denied.length).toBe(1);
  });

  it("detects each PII category, returns only masked metadata and persists no raw values", async () => {
    const res = await request(app).post(`/api/documents/${pdfDocId}/pii-scans`).set(auth("investigator")).send({});
    expect(res.status).toBe(201);
    const scan = res.body.scan;
    expect(scan.status).toBe("COMPLETED");
    expect(scan.textLayer).toBe(true);
    expect(new Set(scan.findings.map((f: any) => f.type))).toEqual(
      new Set(["AADHAAR_LIKE", "PHONE_NUMBER", "EMAIL_ADDRESS", "IP_ADDRESS", "ADDRESS_LIKE"]),
    );
    expect(scan.coverage.ADDRESS_LIKE).toBe("HEURISTIC_LIMITED");
    expect(scan.limitations.join(" ")).toMatch(/not exhaustive/);
    expect(scan.findings.find((f: any) => f.type === "AADHAAR_LIKE").maskedPreview).toMatch(/^XXXX XXXX \d{4}$/);

    const responseText = JSON.stringify(res.body);
    for (const raw of RAW_PII_VALUES) expect(responseText).not.toContain(raw);
    expect(responseText).not.toContain("fingerprint");

    const stored = JSON.stringify(await prisma.piiFinding.findMany({ where: { scanId: scan.id } }));
    for (const raw of RAW_PII_VALUES) expect(stored).not.toContain(raw);

    expect(await auditRows({ documentId: pdfDocId, action: "PII_SCAN_STARTED", result: "SUCCESS" })).toHaveLength(1);
    const [completed] = await auditRows({ documentId: pdfDocId, action: "PII_SCAN_COMPLETED" });
    expect((completed.metadata as any).findingCount).toBe(scan.findings.length);
  });

  it("reports formats it cannot read as UNSUPPORTED instead of 'no PII found'", async () => {
    const res = await request(app).post(`/api/documents/${pngDocId}/pii-scans`).set(auth("investigator")).send({});
    expect(res.status).toBe(201);
    expect(res.body.scan.status).toBe("UNSUPPORTED");
    expect(res.body.scan.statusReason).toMatch(/not implemented/);
  });
});

describe("redaction", () => {
  it("creates a separate redacted derivative with a hash, leaving the original object and hash unchanged", async () => {
    const doc = await prisma.document.findUniqueOrThrow({ where: { id: pdfDocId }, include: { versions: true } });
    const original = doc.versions[0];
    const originalBytesBefore = await getStorageProvider().get(original.storageKey);

    const scan = await request(app).get(`/api/documents/${pdfDocId}/pii-scans`).set(auth("investigator"));
    const scanId = scan.body.scans[0].id;
    const detail = await request(app).get(`/api/documents/${pdfDocId}/pii-scans/${scanId}`).set(auth("investigator"));
    const findingIds = detail.body.scan.findings.map((f: any) => f.id);

    const res = await request(app).post(`/api/documents/${pdfDocId}/redactions`).set(auth("investigator")).send({ scanId, findingIds });
    expect(res.status).toBe(201);
    const derivative = res.body.derivative;
    expect(derivative.status).toBe("COMPLETED");
    expect(derivative.type).toBe("REDACTED");
    expect(derivative.sha256Hash).toMatch(/^[0-9a-f]{64}$/);
    expect(derivative.redactionMetadata.verification).toBe("PASSED");
    redactedDerivativeId = derivative.id;

    const row = await prisma.documentDerivative.findUniqueOrThrow({ where: { id: derivative.id } });
    expect(row.storageKey).not.toBe(original.storageKey);
    expect(row.storageKey).toContain("/derived/redacted/");
    const derivedBytes = await getStorageProvider().get(row.storageKey!);
    expect(sha256(derivedBytes)).toBe(derivative.sha256Hash);
    const derivedText = (await extractPdfPlainText(derivedBytes)).join("\n");
    for (const raw of RAW_PII_VALUES) expect(derivedText).not.toContain(raw);

    const originalBytesAfter = await getStorageProvider().get(original.storageKey);
    expect(Buffer.compare(originalBytesBefore, originalBytesAfter)).toBe(0);
    expect(sha256(originalBytesAfter)).toBe(original.sha256Hash);
    const versionsAfter = await prisma.documentVersion.findMany({ where: { documentId: pdfDocId } });
    expect(versionsAfter).toHaveLength(1);
    expect(versionsAfter[0].sha256Hash).toBe(original.sha256Hash);

    const [audit] = await auditRows({ documentId: pdfDocId, action: "PII_REDACTION_CREATED", result: "SUCCESS" });
    expect((audit.metadata as any).derivativeId).toBe(derivative.id);
    expect((audit.metadata as any).redactedCount).toBe(findingIds.length);
  });

  it("rejects findings that do not belong to the scan", async () => {
    const scans = await request(app).get(`/api/documents/${pdfDocId}/pii-scans`).set(auth("investigator"));
    const res = await request(app)
      .post(`/api/documents/${pdfDocId}/redactions`)
      .set(auth("investigator"))
      .send({ scanId: scans.body.scans[0].id, findingIds: [uuidv4()] });
    expect(res.status).toBe(400);
  });
});

describe("watermarking", () => {
  it("creates a watermarked derivative with the authorized recipient and purpose, leaving the original unchanged", async () => {
    const original = (await prisma.documentVersion.findFirstOrThrow({ where: { documentId: pdfDocId } }));
    const res = await request(app)
      .post(`/api/documents/${pdfDocId}/watermarks`)
      .set(auth("investigator"))
      .send({ recipient: "Forensic Lab Liaison", purpose: "FORENSIC_EXAMINATION", redactedDerivativeId });
    expect(res.status).toBe(201);
    expect(res.body.derivative.type).toBe("WATERMARKED");
    expect(res.body.derivative.parentDerivativeId).toBe(redactedDerivativeId);

    const file = await request(app)
      .get(`/api/documents/${pdfDocId}/derivatives/${res.body.derivative.id}/download`)
      .set(auth("investigator"))
      .buffer(true)
      .parse(binaryParser);
    expect(file.status).toBe(200);
    expect(sha256(file.body)).toBe(res.body.derivative.sha256Hash);
    const text = (await extractPdfPlainText(file.body)).join("\n");
    expect(text).toContain("Recipient: Forensic Lab Liaison");
    expect(text).toContain("Purpose: Forensic Examination");
    expect(text).not.toContain(FICTIONAL_PII.email);

    const stored = await getStorageProvider().get(original.storageKey);
    expect(sha256(stored)).toBe(original.sha256Hash);
    expect(await auditRows({ documentId: pdfDocId, action: "WATERMARK_CREATED", result: "SUCCESS" })).not.toHaveLength(0);
  });
});

describe("controlled sharing — authorization", () => {
  it("rejects sharing by a user whose role lacks document.share", async () => {
    const res = await createShare({ requireApproval: false }, "investigator");
    expect(res.status).toBe(403);
    expect(await auditRows({ documentId: pdfDocId, action: "SHARE_REQUEST_CREATED", result: "DENIED" })).toHaveLength(1);
  });

  it("rejects a recipient outside the case's organization", async () => {
    const res = await createShare({ recipientUserId: actors.outsider.id });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_RECIPIENT");
  });

  it("rejects an expiry in the past", async () => {
    const res = await createShare({ expiresAt: new Date(Date.now() - DAY).toISOString() });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_SHARE_WINDOW");
  });

  it("requires a redacted copy when redaction is requested", async () => {
    const res = await createShare({ applyRedaction: true });
    expect(res.status).toBe(400);
  });
});

describe("controlled sharing — authorized flow and downloads", () => {
  let shareId: string;

  it("lets an authorized sharer create an auto-approved, redacted + watermarked share and audits it with purpose", async () => {
    const res = await createShare({ requireApproval: false, allowDownload: true, applyRedaction: true, redactedDerivativeId, applyWatermark: true });
    expect(res.status).toBe(201);
    expect(res.body.share.status).toBe("APPROVED");
    shareId = res.body.share.id;

    for (const action of ["SHARE_REQUEST_CREATED", "SHARE_REQUEST_APPROVED", "SHARE_ACCESS_GRANTED"]) {
      const [row] = await auditRows({ action, resource: `share:${shareId}` });
      expect(row, action).toBeDefined();
      expect((row.metadata as any).purpose).toBe("COURT_FILING");
      expect((row.metadata as any).recipientUserId).toBe(actors.prosecutor.id);
    }
    // The share never grants a document/case permission.
    expect(await prisma.documentPermission.count({ where: { userId: actors.prosecutor.id } })).toBe(0);
  });

  it("serves the recipient a redacted, watermarked copy and logs the download", async () => {
    const detail = await request(app).get(`/api/shares/${shareId}`).set(auth("prosecutor"));
    expect(detail.body.share.access).toMatchObject({ canView: true, canDownload: true });

    const res = await request(app).get(`/api/shares/${shareId}/download`).set(auth("prosecutor")).buffer(true).parse(binaryParser);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
    expect(res.headers["cache-control"]).toBe("no-store");
    const text = (await extractPdfPlainText(res.body)).join("\n");
    expect(text).toContain("Recipient: Prosecutor Office (Test prosecutor)");
    expect(text).toContain("Purpose: Court Filing");
    for (const raw of RAW_PII_VALUES) expect(text).not.toContain(raw);

    const [download] = await auditRows({ action: "DOCUMENT_DOWNLOADED", resource: `share:${shareId}` });
    expect(download.actorId).toBe(actors.prosecutor.id);
    expect((download.metadata as any).via).toBe("share");
    const delivered = await prisma.documentDerivative.findMany({ where: { shareId } });
    expect(delivered).toHaveLength(1);
    expect(delivered[0].parentDerivativeId).toBe(redactedDerivativeId);
  });

  it("does not let the share recipient download the original through the document API", async () => {
    const res = await request(app).get(`/api/documents/${pdfDocId}/download`).set(auth("prosecutor"));
    expect(res.status).toBe(403);
    const denied = await auditRows({ documentId: pdfDocId, action: "DOWNLOAD_DENIED", actorId: actors.prosecutor.id });
    expect(denied.length).toBeGreaterThan(0);
  });

  it("rejects and flags an unauthorized user calling the share endpoints directly", async () => {
    const res = await request(app).get(`/api/shares/${shareId}/download`).set(auth("lawyer"));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("NOT_RECIPIENT");
    expect(await auditRows({ action: "UNAUTHORIZED_ACCESS_ATTEMPT", actorId: actors.lawyer.id })).toHaveLength(1);
    expect(await auditRows({ action: "DOWNLOAD_DENIED", actorId: actors.lawyer.id, resource: `share:${shareId}` })).toHaveLength(1);
    expect(await prisma.securityEvent.count({ where: { type: "SUSPICIOUS_ACCESS", userId: actors.lawyer.id } })).toBe(1);

    const detail = await request(app).get(`/api/shares/${shareId}`).set(auth("lawyer"));
    expect(detail.status).toBe(403);
  });

  it("revoked access is rejected by the backend", async () => {
    const revoke = await request(app).post(`/api/shares/${shareId}/revoke`).set(auth("senior")).send({ note: "Filing withdrawn" });
    expect(revoke.status).toBe(200);
    expect(revoke.body.share.status).toBe("REVOKED");
    expect(await auditRows({ action: "SHARE_ACCESS_REVOKED", resource: `share:${shareId}` })).toHaveLength(1);

    const res = await request(app).get(`/api/shares/${shareId}/download`).set(auth("prosecutor"));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("SHARE_REVOKED");
    const view = await request(app).get(`/api/shares/${shareId}/view`).set(auth("prosecutor"));
    expect(view.status).toBe(403);
  });
});

describe("controlled sharing — download control, approval and expiration", () => {
  it("view-only shares reject download server-side, allow view, and are always watermarked", async () => {
    const res = await createShare({ requireApproval: false, allowDownload: false, applyWatermark: false });
    expect(res.status).toBe(201);
    expect(res.body.share.applyWatermark).toBe(true);
    expect(res.body.policyAdjustments.join(" ")).toMatch(/watermarked/);
    const id = res.body.share.id;

    const detail = await request(app).get(`/api/shares/${id}`).set(auth("prosecutor"));
    expect(detail.body.share.access).toMatchObject({ canView: true, canDownload: false });

    const download = await request(app).get(`/api/shares/${id}/download`).set(auth("prosecutor"));
    expect(download.status).toBe(403);
    expect(download.body.error.code).toBe("DOWNLOAD_NOT_PERMITTED");
    const [denied] = await auditRows({ action: "DOWNLOAD_DENIED", resource: `share:${id}` });
    expect((denied.metadata as any).code).toBe("DOWNLOAD_NOT_PERMITTED");

    const view = await request(app).get(`/api/shares/${id}/view`).set(auth("prosecutor")).buffer(true).parse(binaryParser);
    expect(view.status).toBe(200);
    expect(view.headers["content-disposition"]).toMatch(/^inline/);
    expect((await extractPdfPlainText(view.body)).join("\n")).toContain("Purpose: Court Filing");
    expect(await auditRows({ action: "DOCUMENT_VIEWED", resource: `share:${id}`, result: "SUCCESS" })).toHaveLength(1);
  });

  it("pending shares are unusable until approved by someone other than the requester", async () => {
    const res = await createShare({ requireApproval: true, allowDownload: true });
    expect(res.body.share.status).toBe("PENDING");
    const id = res.body.share.id;

    expect((await request(app).get(`/api/shares/${id}/view`).set(auth("prosecutor"))).body.error.code).toBe("SHARE_PENDING");

    const self = await request(app).post(`/api/shares/${id}/approve`).set(auth("senior")).send({});
    expect(self.status).toBe(403);
    expect(self.body.error.code).toBe("SEPARATION_OF_DUTIES");

    const noPermission = await request(app).post(`/api/shares/${id}/approve`).set(auth("prosecutor")).send({});
    expect(noPermission.status).toBe(403);

    const approvals = await request(app).get("/api/shares").query({ scope: "approvals" }).set(auth("admin"));
    expect(approvals.body.shares.map((s: any) => s.id)).toContain(id);

    const approved = await request(app).post(`/api/shares/${id}/approve`).set(auth("admin")).send({ note: "Approved for filing" });
    expect(approved.status).toBe(200);
    expect(approved.body.share.status).toBe("APPROVED");
    expect(await auditRows({ action: "SHARE_REQUEST_APPROVED", resource: `share:${id}`, actorId: actors.admin.id })).toHaveLength(1);
    expect(await auditRows({ action: "SHARE_ACCESS_GRANTED", resource: `share:${id}` })).toHaveLength(1);

    const view = await request(app).get(`/api/shares/${id}/view`).set(auth("prosecutor"));
    expect(view.status).toBe(200);
  });

  it("rejected shares are logged and unusable", async () => {
    const res = await createShare({ requireApproval: true });
    const id = res.body.share.id;
    const rejected = await request(app)
      .post(`/api/shares/${id}/reject`)
      .set(auth("admin"))
      .send({ note: `Not needed; contact ${FICTIONAL_PII.email}` });
    expect(rejected.body.share.status).toBe("REJECTED");
    const [row] = await auditRows({ action: "SHARE_REQUEST_REJECTED", resource: `share:${id}` });
    expect(row.reason).not.toContain(FICTIONAL_PII.email); // masked by the audit sanitizer
    expect((await request(app).get(`/api/shares/${id}/view`).set(auth("prosecutor"))).body.error.code).toBe("SHARE_REJECTED");
  });

  it("an active share works and the same share is rejected once expired, even via direct API calls", async () => {
    const res = await createShare({ requireApproval: false, allowDownload: true });
    const id = res.body.share.id;
    expect((await request(app).get(`/api/shares/${id}/download`).set(auth("prosecutor"))).status).toBe(200);

    // Simulate the passage of time: the share's window closes.
    await prisma.documentShare.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const expired = await request(app).get(`/api/shares/${id}/download`).set(auth("prosecutor"));
    expect(expired.status).toBe(403);
    expect(expired.body.error.code).toBe("SHARE_EXPIRED");
    expect((await prisma.documentShare.findUniqueOrThrow({ where: { id } })).status).toBe("EXPIRED");
    expect(await auditRows({ action: "SHARE_ACCESS_EXPIRED", resource: `share:${id}` })).toHaveLength(1);
    expect(await prisma.securityEvent.count({ where: { type: "EXPIRED_ACCESS", userId: actors.prosecutor.id } })).toBeGreaterThan(0);

    const view = await request(app).get(`/api/shares/${id}/view`).set(auth("prosecutor"));
    expect(view.status).toBe(403);
    expect(view.body.error.code).toBe("SHARE_EXPIRED");
  });

  it("a share that has not started yet is rejected", async () => {
    const res = await createShare({
      requireApproval: false,
      startsAt: new Date(Date.now() + DAY).toISOString(),
      expiresAt: new Date(Date.now() + 3 * DAY).toISOString(),
    });
    const view = await request(app).get(`/api/shares/${res.body.share.id}/view`).set(auth("prosecutor"));
    expect(view.status).toBe(403);
    expect(view.body.error.code).toBe("SHARE_NOT_STARTED");
  });

  it("lists incoming shares for the recipient only", async () => {
    const incoming = await request(app).get("/api/shares").query({ scope: "incoming" }).set(auth("prosecutor"));
    expect(incoming.status).toBe(200);
    expect(incoming.body.shares.length).toBeGreaterThan(0);
    expect(incoming.body.shares.every((s: any) => s.recipient.id === actors.prosecutor.id)).toBe(true);
    const lawyer = await request(app).get("/api/shares").query({ scope: "incoming" }).set(auth("lawyer"));
    expect(lawyer.body.shares).toHaveLength(0);
  });
});

describe("audit trail hygiene", () => {
  it("never stores raw PII in any audit event (reason or metadata)", async () => {
    const rows = await prisma.auditEvent.findMany();
    expect(rows.length).toBeGreaterThan(20);
    const serialized = JSON.stringify(rows);
    for (const raw of RAW_PII_VALUES) expect(serialized).not.toContain(raw);
  });

  it("records a request/correlation ID on every Phase 2 event", async () => {
    const rows = await prisma.auditEvent.findMany({
      where: { action: { in: ["PII_SCAN_STARTED", "PII_SCAN_COMPLETED", "PII_REDACTION_CREATED", "WATERMARK_CREATED", "SHARE_REQUEST_CREATED"] } },
    });
    expect(rows.every((r) => r.requestId && r.requestId.length > 0)).toBe(true);
  });
});
