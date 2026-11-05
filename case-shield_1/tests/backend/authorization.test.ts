import { describe, it, expect, vi, beforeEach } from "vitest";

// Unit-tests the core authorization model (Person -> Role -> Organization ->
// Case -> Document -> Permission -> Action) in isolation by mocking Prisma,
// so these run without a live database. See docs/security-architecture.md
// §5 and backend/src/lib/authorization.ts.

const findManyCasePermission = vi.fn();
const findManyDocumentPermission = vi.fn();
const findUniqueCaseAssignment = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    casePermission: { findMany: (...args: any[]) => findManyCasePermission(...args) },
    documentPermission: { findMany: (...args: any[]) => findManyDocumentPermission(...args) },
    caseAssignment: { findUnique: (...args: any[]) => findUniqueCaseAssignment(...args) },
  },
}));

import { can, hasCaseAccess } from "../../backend/src/lib/authorization";
import { PERMISSIONS } from "../../backend/src/lib/permissions";
import { AuthenticatedUser } from "../../backend/src/middleware/auth";

function makeUser(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: "user-1",
    email: "investigator@caseshield.local",
    fullName: "Officer Test",
    organizationId: "org-1",
    roles: ["INVESTIGATOR"],
    roleIds: ["role-investigator"],
    ...overrides,
  };
}

beforeEach(() => {
  findManyCasePermission.mockReset().mockResolvedValue([]);
  findManyDocumentPermission.mockReset().mockResolvedValue([]);
  findUniqueCaseAssignment.mockReset().mockResolvedValue(null);
});

describe("hasCaseAccess", () => {
  it("denies access across organizations even for the investigating officer", async () => {
    const user = makeUser({ organizationId: "org-1" });
    const foreignCase = { id: "case-1", organizationId: "org-2", investigatingOfficerId: "user-1", confidentiality: "INTERNAL" };
    await expect(hasCaseAccess(user, foreignCase)).resolves.toBe(false);
  });

  it("denies a user with no assignment, no grant, and no oversight role", async () => {
    const user = makeUser({ roles: ["LAWYER"], roleIds: ["role-lawyer"] });
    const caseRecord = { id: "case-1", organizationId: "org-1", investigatingOfficerId: "someone-else", confidentiality: "INTERNAL" };
    await expect(hasCaseAccess(user, caseRecord)).resolves.toBe(false);
  });

  it("allows the investigating officer", async () => {
    const user = makeUser();
    const caseRecord = { id: "case-1", organizationId: "org-1", investigatingOfficerId: "user-1", confidentiality: "INTERNAL" };
    await expect(hasCaseAccess(user, caseRecord)).resolves.toBe(true);
  });

  it("allows ADMIN and AUDITOR oversight roles within the same organization without an explicit assignment", async () => {
    const auditor = makeUser({ id: "auditor-1", roles: ["AUDITOR"], roleIds: ["role-auditor"] });
    const caseRecord = { id: "case-1", organizationId: "org-1", investigatingOfficerId: "someone-else", confidentiality: "INTERNAL" };
    await expect(hasCaseAccess(auditor, caseRecord)).resolves.toBe(true);
  });

  it("allows a user with an active case assignment", async () => {
    findUniqueCaseAssignment.mockResolvedValue({ caseId: "case-1", userId: "user-1" });
    const user = makeUser();
    const caseRecord = { id: "case-1", organizationId: "org-1", investigatingOfficerId: "someone-else", confidentiality: "INTERNAL" };
    await expect(hasCaseAccess(user, caseRecord)).resolves.toBe(true);
  });
});

describe("can()", () => {
  const caseRecord = { id: "case-1", organizationId: "org-1", investigatingOfficerId: "user-1", confidentiality: "INTERNAL" };

  it("grants a permission included in the user's role baseline", async () => {
    const user = makeUser(); // INVESTIGATOR includes document.upload
    const result = await can(user, PERMISSIONS.DOCUMENT_UPLOAD, { case: caseRecord });
    expect(result.allowed).toBe(true);
  });

  it("denies a permission not included in the user's role baseline", async () => {
    const user = makeUser({ roles: ["LAWYER"], roleIds: ["role-lawyer"] });
    // LAWYER does not include document.upload, and this user is not the
    // investigating officer here.
    const otherCase = { ...caseRecord, investigatingOfficerId: "someone-else" };
    const result = await can(user, PERMISSIONS.DOCUMENT_UPLOAD, { case: otherCase });
    expect(result.allowed).toBe(false);
  });

  it("denies access entirely when the case itself is not visible to the user", async () => {
    const user = makeUser({ id: "user-2", roles: ["INVESTIGATOR"], roleIds: ["role-investigator"] });
    const otherCase = { ...caseRecord, investigatingOfficerId: "someone-else" };
    const result = await can(user, PERMISSIONS.DOCUMENT_VIEW, { case: otherCase });
    expect(result.allowed).toBe(false);
  });

  it("requires an explicit grant for RESTRICTED documents even when the role baseline includes the permission", async () => {
    const user = makeUser(); // investigating officer, INVESTIGATOR role includes document.view
    const restrictedDoc = { id: "doc-1", caseId: "case-1", confidentiality: "RESTRICTED" };
    const result = await can(user, PERMISSIONS.DOCUMENT_VIEW, { case: caseRecord, document: restrictedDoc });
    expect(result.allowed).toBe(false);
  });

  it("allows a RESTRICTED document once an explicit document-level grant exists", async () => {
    findManyDocumentPermission.mockResolvedValue([{ permission: { key: PERMISSIONS.DOCUMENT_VIEW } }]);
    const user = makeUser();
    const restrictedDoc = { id: "doc-1", caseId: "case-1", confidentiality: "RESTRICTED" };
    const result = await can(user, PERMISSIONS.DOCUMENT_VIEW, { case: caseRecord, document: restrictedDoc });
    expect(result.allowed).toBe(true);
  });

  it("requires an explicit case grant for RESTRICTED evidence even for the investigating officer", async () => {
    const user = makeUser();
    const denied = await can(user, PERMISSIONS.EVIDENCE_VIEW, { case: caseRecord, evidence: { confidentiality: "RESTRICTED" } });
    expect(denied.allowed).toBe(false);

    findManyCasePermission.mockResolvedValue([{ permission: { key: PERMISSIONS.EVIDENCE_VIEW } }]);
    const granted = await can(user, PERMISSIONS.EVIDENCE_VIEW, { case: caseRecord, evidence: { confidentiality: "RESTRICTED" } });
    expect(granted.allowed).toBe(true);
  });

  it("treats evidence in a RESTRICTED case as high-sensitivity even if the item itself is INTERNAL", async () => {
    const user = makeUser();
    const restrictedCase = { ...caseRecord, confidentiality: "RESTRICTED" };
    const result = await can(user, PERMISSIONS.EVIDENCE_VIEW, { case: restrictedCase, evidence: { confidentiality: "INTERNAL" } });
    expect(result.allowed).toBe(false);
  });

  it("does not let a role baseline reach evidence on a case the user cannot access", async () => {
    const forensic = makeUser({ id: "user-9", roles: ["FORENSIC_OFFICER"], roleIds: ["role-forensic"] });
    const otherCase = { ...caseRecord, investigatingOfficerId: "someone-else" };
    const result = await can(forensic, PERMISSIONS.EVIDENCE_EXAMINE, { case: otherCase, evidence: { confidentiality: "INTERNAL" } });
    expect(result.allowed).toBe(false);
  });

  it("honors a case-level permission grant beyond the role baseline (view but not download example)", async () => {
    // A LAWYER's baseline does not include document.download. A case-level
    // grant for document.download only should allow download but the
    // absence of a similar grant for a different permission should still
    // deny it — demonstrating "view but not download" from
    // docs/product-requirements.md §4.
    findManyCasePermission.mockResolvedValue([{ permission: { key: PERMISSIONS.DOCUMENT_DOWNLOAD } }]);
    const user = makeUser({ roles: ["LAWYER"], roleIds: ["role-lawyer"] });
    const ownedCase = { ...caseRecord, investigatingOfficerId: "user-1" };

    const downloadResult = await can(user, PERMISSIONS.DOCUMENT_DOWNLOAD, { case: ownedCase });
    expect(downloadResult.allowed).toBe(true);

    const shareResult = await can(user, PERMISSIONS.DOCUMENT_SHARE, { case: ownedCase });
    expect(shareResult.allowed).toBe(false);
  });
});
