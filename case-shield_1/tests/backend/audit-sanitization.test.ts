import { describe, it, expect } from "vitest";
import { sanitizeAuditMetadata } from "../../backend/src/modules/audit/audit.service";
import { FICTIONAL_PII } from "../../prisma/fixtures/fictional-pii-document";

describe("audit metadata sanitization", () => {
  it("masks PII that reaches audit metadata by mistake, at any depth", () => {
    const sanitized = sanitizeAuditMetadata({
      note: `Contact ${FICTIONAL_PII.email}`,
      nested: { phone: FICTIONAL_PII.phone, list: [FICTIONAL_PII.aadhaar] },
    });
    const serialized = JSON.stringify(sanitized);
    expect(serialized).not.toContain(FICTIONAL_PII.email);
    expect(serialized).not.toContain(FICTIONAL_PII.aadhaar);
    expect(serialized).not.toContain("98765 00001");
    expect(serialized).toContain("XXXX XXXX");
  });

  it("leaves identifiers, hashes, numbers and booleans intact", () => {
    const id = "0b9d6f7e-1c2a-4e5b-9a8c-123456789012";
    const hash = "a".repeat(20) + "234567890123" + "b".repeat(32);
    const sanitized = sanitizeAuditMetadata({ shareId: id, sha256: hash, count: 3, allowDownload: false, purpose: "COURT_FILING" });
    expect(sanitized).toEqual({ shareId: id, sha256: hash, count: 3, allowDownload: false, purpose: "COURT_FILING" });
  });
});
