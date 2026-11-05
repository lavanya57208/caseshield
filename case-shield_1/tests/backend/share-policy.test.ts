import { describe, it, expect } from "vitest";
import { evaluateShareAccess, validateShareWindow, ShareForPolicy, MAX_SHARE_DURATION_DAYS } from "../../backend/src/modules/sharing/share-policy";

const NOW = new Date("2026-09-25T10:00:00Z");
const HOUR = 60 * 60 * 1000;
const recipient = { id: "user-recipient", organizationId: "org-1" };

function share(overrides: Partial<ShareForPolicy> = {}): ShareForPolicy {
  return {
    recipientUserId: recipient.id,
    status: "APPROVED",
    startsAt: new Date(NOW.getTime() - HOUR),
    expiresAt: new Date(NOW.getTime() + 24 * HOUR),
    allowDownload: true,
    revokedAt: null,
    organizationId: "org-1",
    ...overrides,
  };
}

describe("evaluateShareAccess", () => {
  it("allows the recipient of an active share to view and download", () => {
    expect(evaluateShareAccess(share(), recipient, "view", NOW).allowed).toBe(true);
    expect(evaluateShareAccess(share(), recipient, "download", NOW).allowed).toBe(true);
  });

  it("denies any user who is not the recipient", () => {
    const d = evaluateShareAccess(share(), { id: "someone-else", organizationId: "org-1" }, "view", NOW);
    expect(d).toMatchObject({ allowed: false, code: "NOT_RECIPIENT" });
  });

  it("denies a recipient whose organization no longer matches the case", () => {
    const d = evaluateShareAccess(share(), { ...recipient, organizationId: "org-2" }, "view", NOW);
    expect(d).toMatchObject({ allowed: false, code: "TENANT_MISMATCH" });
  });

  it("denies expired shares, flagging a status transition when still stored as APPROVED", () => {
    const d = evaluateShareAccess(share({ expiresAt: new Date(NOW.getTime() - 1) }), recipient, "download", NOW);
    expect(d).toMatchObject({ allowed: false, code: "SHARE_EXPIRED", expiredTransition: true });
    const stored = evaluateShareAccess(share({ status: "EXPIRED" }), recipient, "view", NOW);
    expect(stored).toMatchObject({ allowed: false, code: "SHARE_EXPIRED", expiredTransition: false });
  });

  it("treats the exact expiry instant as expired", () => {
    expect(evaluateShareAccess(share({ expiresAt: NOW }), recipient, "view", NOW)).toMatchObject({ allowed: false, code: "SHARE_EXPIRED" });
  });

  it("denies revoked, rejected and pending shares", () => {
    expect(evaluateShareAccess(share({ status: "REVOKED" }), recipient, "view", NOW)).toMatchObject({ code: "SHARE_REVOKED" });
    expect(evaluateShareAccess(share({ revokedAt: NOW }), recipient, "view", NOW)).toMatchObject({ code: "SHARE_REVOKED" });
    expect(evaluateShareAccess(share({ status: "REJECTED" }), recipient, "view", NOW)).toMatchObject({ code: "SHARE_REJECTED" });
    expect(evaluateShareAccess(share({ status: "PENDING" }), recipient, "view", NOW)).toMatchObject({ code: "SHARE_PENDING" });
  });

  it("denies access before startsAt", () => {
    const d = evaluateShareAccess(share({ startsAt: new Date(NOW.getTime() + HOUR) }), recipient, "view", NOW);
    expect(d).toMatchObject({ allowed: false, code: "SHARE_NOT_STARTED" });
  });

  it("allows view but denies download when download is disabled", () => {
    const viewOnly = share({ allowDownload: false });
    expect(evaluateShareAccess(viewOnly, recipient, "view", NOW).allowed).toBe(true);
    expect(evaluateShareAccess(viewOnly, recipient, "download", NOW)).toMatchObject({ allowed: false, code: "DOWNLOAD_NOT_PERMITTED" });
  });

  it("checks the recipient before revealing share state", () => {
    const d = evaluateShareAccess(share({ status: "REVOKED" }), { id: "intruder", organizationId: "org-1" }, "view", NOW);
    expect(d).toMatchObject({ code: "NOT_RECIPIENT" });
  });
});

describe("validateShareWindow", () => {
  it("accepts a window starting now", () => {
    expect(validateShareWindow(NOW, new Date(NOW.getTime() + 5 * 24 * HOUR), NOW)).toBeNull();
  });

  it("rejects expiry in the past, before start, beyond the maximum duration, or a start in the past", () => {
    expect(validateShareWindow(NOW, new Date(NOW.getTime() - HOUR), NOW)).toMatch(/future/);
    expect(validateShareWindow(new Date(NOW.getTime() + 3 * HOUR), new Date(NOW.getTime() + 2 * HOUR), NOW)).toMatch(/after the start/);
    expect(validateShareWindow(NOW, new Date(NOW.getTime() + (MAX_SHARE_DURATION_DAYS + 1) * 24 * HOUR), NOW)).toMatch(/at most/);
    expect(validateShareWindow(new Date(NOW.getTime() - 24 * HOUR), new Date(NOW.getTime() + HOUR), NOW)).toMatch(/past/);
  });
});
