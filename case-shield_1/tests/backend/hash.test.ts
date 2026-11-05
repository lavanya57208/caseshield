import { describe, it, expect } from "vitest";
import { sha256 } from "../../backend/src/lib/hash";

describe("sha256", () => {
  it("computes the correct hash for a known input", () => {
    // Well-known test vector: SHA-256("abc")
    const result = sha256(Buffer.from("abc", "utf-8"));
    expect(result).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("is deterministic for identical content", () => {
    const buf = Buffer.from("Case Shield forensic report fixture", "utf-8");
    expect(sha256(buf)).toBe(sha256(Buffer.from(buf)));
  });

  it("produces different hashes for different content (tamper detection)", () => {
    const original = sha256(Buffer.from("original content", "utf-8"));
    const tampered = sha256(Buffer.from("original content ", "utf-8")); // trailing space
    expect(original).not.toBe(tampered);
  });
});
