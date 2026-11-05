import { describe, it, expect } from "vitest";
import { nextStatus, canTransition, InvalidTransitionError, EVIDENCE_STATUSES } from "../../backend/src/modules/evidence/evidence-lifecycle";

describe("evidence lifecycle transitions", () => {
  it("follows the documented happy path", () => {
    let s = nextStatus("REGISTERED", "TRANSFERRED");
    expect(s).toBe("TRANSFERRED");
    s = nextStatus(s, "RECEIVED", "REGISTERED");
    expect(s).toBe("IN_CUSTODY");
    s = nextStatus(s, "EXAMINED");
    expect(s).toBe("UNDER_EXAMINATION");
    s = nextStatus(s, "TRANSFERRED");
    s = nextStatus(s, "RECEIVED", "UNDER_EXAMINATION");
    expect(s).toBe("IN_CUSTODY");
    s = nextStatus(s, "SUBMITTED");
    expect(s).toBe("SUBMITTED_TO_COURT");
    s = nextStatus(s, "RETURNED");
    expect(s).toBe("RETURNED");
    s = nextStatus(s, "ARCHIVED");
    expect(s).toBe("ARCHIVED");
  });

  it("keeps a sealed item sealed through a transfer, and restores status on rejection/cancellation", () => {
    expect(nextStatus("TRANSFERRED", "RECEIVED", "SEALED")).toBe("SEALED");
    expect(nextStatus("TRANSFERRED", "TRANSFER_REJECTED", "UNDER_EXAMINATION")).toBe("UNDER_EXAMINATION");
    expect(nextStatus("TRANSFERRED", "TRANSFER_CANCELLED", "SEALED")).toBe("SEALED");
  });

  it.each([
    ["REGISTERED", "RECEIVED"], // nothing to receive
    ["IN_CUSTODY", "UNSEALED"], // not sealed
    ["SEALED", "EXAMINED"], // must unseal first
    ["TRANSFERRED", "TRANSFERRED"], // already pending
    ["TRANSFERRED", "EXAMINED"],
    ["SUBMITTED_TO_COURT", "TRANSFERRED"], // court holds it
    ["SUBMITTED_TO_COURT", "EXAMINED"],
    ["IN_CUSTODY", "RETURNED"], // never submitted
    ["REGISTERED", "ARCHIVED"],
    ["ARCHIVED", "TRANSFERRED"], // terminal
    ["ARCHIVED", "UNSEALED"],
  ] as const)("rejects %s -> %s", (status, action) => {
    expect(() => nextStatus(status, action as any)).toThrow(InvalidTransitionError);
    expect(canTransition(status, action as any)).toBe(false);
  });

  it("never changes status for access and verification events, in any status", () => {
    for (const s of EVIDENCE_STATUSES) {
      expect(nextStatus(s, "VIEWED")).toBe(s);
      expect(nextStatus(s, "VERIFIED")).toBe(s);
    }
  });

  it("allows nothing but access/verification once archived", () => {
    for (const a of ["TRANSFERRED", "EXAMINED", "SEALED", "UNSEALED", "SUBMITTED", "RETURNED", "ARCHIVED"] as const) {
      expect(canTransition("ARCHIVED", a)).toBe(false);
    }
  });
});
