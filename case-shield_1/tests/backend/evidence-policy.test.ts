import { describe, it, expect } from "vitest";
import {
  allowedEvidenceActions,
  canViewEvidence,
  isCourtOnlyViewer,
  validateTransferTarget,
  EvidencePermission,
} from "../../backend/src/modules/evidence/evidence-policy";
import { ROLE_BASELINE_PERMISSIONS } from "../../backend/src/lib/permissions";

const perms = (role: string) => new Set(ROLE_BASELINE_PERMISSIONS[role] as unknown as EvidencePermission[]);

const held = { status: "IN_CUSTODY" as const, currentCustodianId: "custodian", originalVersionId: "v1", submittedAt: null };

describe("evidence visibility", () => {
  it("requires evidence.view", () => {
    expect(canViewEvidence(held, perms("LAWYER"), false)).toBe(false);
    expect(canViewEvidence(held, perms("INVESTIGATOR"), false)).toBe(true);
  });

  it("limits a Judge to evidence submitted to court", () => {
    const courtOnly = isCourtOnlyViewer(["JUDGE"], false);
    expect(courtOnly).toBe(true);
    expect(canViewEvidence(held, perms("JUDGE"), courtOnly)).toBe(false);
    expect(canViewEvidence({ submittedAt: new Date() }, perms("JUDGE"), courtOnly)).toBe(true);
  });

  it("does not restrict a Judge holding an explicit evidence.view grant, nor investigative roles", () => {
    expect(isCourtOnlyViewer(["JUDGE"], true)).toBe(false);
    expect(isCourtOnlyViewer(["INVESTIGATOR"], false)).toBe(false);
    expect(isCourtOnlyViewer(["JUDGE", "AUDITOR"], false)).toBe(false);
  });
});

describe("allowed evidence actions", () => {
  it("lets the custodian transfer/seal/verify but not a non-custodian", () => {
    const custodian = allowedEvidenceActions(held, "custodian", perms("INVESTIGATOR"), false, null);
    expect(custodian).toEqual(expect.arrayContaining(["VIEW", "TRANSFER", "SEAL", "VERIFY_INTEGRITY", "VERIFY_CUSTODY"]));
    const other = allowedEvidenceActions(held, "someone-else", perms("INVESTIGATOR"), false, null);
    expect(other).not.toContain("TRANSFER");
    expect(other).not.toContain("SEAL");
  });

  it("gives EXAMINE only to forensic officers holding the item", () => {
    expect(allowedEvidenceActions(held, "custodian", perms("FORENSIC_OFFICER"), false, null)).toContain("EXAMINE");
    expect(allowedEvidenceActions(held, "custodian", perms("INVESTIGATOR"), false, null)).not.toContain("EXAMINE");
  });

  it("offers accept/reject only to the pending recipient and cancel only to the initiator", () => {
    const pendingItem = { ...held, status: "TRANSFERRED" as const };
    const pending = { toCustodianId: "recipient", initiatedById: "custodian", previousStatus: "IN_CUSTODY" as const };
    expect(allowedEvidenceActions(pendingItem, "recipient", perms("FORENSIC_OFFICER"), false, pending)).toEqual(
      expect.arrayContaining(["ACCEPT_TRANSFER", "REJECT_TRANSFER"]),
    );
    const initiator = allowedEvidenceActions(pendingItem, "custodian", perms("INVESTIGATOR"), false, pending);
    expect(initiator).toContain("CANCEL_TRANSFER");
    expect(initiator).not.toContain("TRANSFER");
    expect(initiator).not.toContain("ACCEPT_TRANSFER");
    expect(allowedEvidenceActions(pendingItem, "bystander", perms("SENIOR_INVESTIGATOR"), false, pending)).not.toContain("ACCEPT_TRANSFER");
  });

  it("returns nothing for users who cannot view the item", () => {
    expect(allowedEvidenceActions(held, "custodian", perms("LAWYER"), false, null)).toEqual([]);
  });

  it("only offers integrity verification when a digital file is attached", () => {
    expect(allowedEvidenceActions({ ...held, originalVersionId: null }, "custodian", perms("AUDITOR"), false, null)).not.toContain("VERIFY_INTEGRITY");
  });
});

describe("transfer target validation", () => {
  const base = {
    reason: "Forensic examination",
    currentCustodianId: "custodian",
    organizationId: "org-1",
    recipient: { id: "recipient", status: "ACTIVE", organizationId: "org-1", deletedAt: null },
    recipientHasCaseAccess: true,
    recipientCanReceive: true,
  };

  it("accepts a valid recipient", () => {
    expect(validateTransferTarget(base)).toEqual({ ok: true });
  });

  it.each([
    [{ reason: "  " }, "REASON_REQUIRED"],
    [{ recipient: null }, "RECIPIENT_NOT_FOUND"],
    [{ recipient: { ...base.recipient, id: "custodian" } }, "SAME_CUSTODIAN"],
    [{ recipient: { ...base.recipient, organizationId: "org-2" } }, "RECIPIENT_OTHER_ORGANIZATION"],
    [{ recipient: { ...base.recipient, status: "SUSPENDED" } }, "RECIPIENT_INACTIVE"],
    [{ recipient: { ...base.recipient, deletedAt: new Date() } }, "RECIPIENT_INACTIVE"],
    [{ recipientHasCaseAccess: false }, "RECIPIENT_NO_CASE_ACCESS"],
    [{ recipientCanReceive: false }, "RECIPIENT_NOT_AUTHORIZED"],
  ])("rejects %o with %s", (override, code) => {
    const result = validateTransferTarget({ ...base, ...(override as any) });
    expect(result.ok).toBe(false);
    expect((result as any).code).toBe(code);
  });
});
