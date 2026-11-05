import { describe, it, expect } from "vitest";
import {
  canonicalCustodyEvent,
  computeCustodyEventHash,
  verifyCustodyChain,
  StoredCustodyEvent,
} from "../../backend/src/modules/evidence/custody-chain";

// Pure tests of the hash-linked custody timeline. All identifiers are
// synthetic.

function buildChain(n: number): StoredCustodyEvent[] {
  const events: StoredCustodyEvent[] = [];
  let previousEventHash: string | null = null;
  const actions = ["REGISTERED", "TRANSFERRED", "RECEIVED", "EXAMINED", "TRANSFERRED", "RECEIVED"];
  for (let i = 1; i <= n; i++) {
    const base = {
      evidenceId: "evidence-1",
      sequence: i,
      action: actions[(i - 1) % actions.length],
      fromUserId: i === 1 ? null : "user-a",
      toUserId: "user-b",
      actorId: "user-a",
      organizationId: "org-1",
      transferId: null,
      reason: `Step ${i}`,
      notes: null,
      location: null,
      hashAtEvent: "a".repeat(64),
      occurredAt: new Date(Date.UTC(2026, 8, 25, 9, i)),
      previousEventHash,
    };
    const eventHash = computeCustodyEventHash(base);
    events.push({ ...base, id: `event-${i}`, eventHash });
    previousEventHash = eventHash;
  }
  return events;
}

describe("custody event hashing", () => {
  it("is deterministic and a 64-char hex SHA-256", () => {
    const [e] = buildChain(1);
    expect(computeCustodyEventHash(e)).toBe(e.eventHash);
    expect(e.eventHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when any hashed field changes", () => {
    const [e] = buildChain(1);
    for (const change of [{ reason: "edited" }, { actorId: "user-x" }, { toUserId: "user-x" }, { occurredAt: new Date(0) }, { action: "SEALED" }, { hashAtEvent: "b".repeat(64) }]) {
      expect(computeCustodyEventHash({ ...e, ...change })).not.toBe(e.eventHash);
    }
  });

  it("links each event to the previous event's hash", () => {
    const chain = buildChain(4);
    expect(chain[0].previousEventHash).toBeNull();
    for (let i = 1; i < chain.length; i++) expect(chain[i].previousEventHash).toBe(chain[i - 1].eventHash);
  });

  it("depends on the previous hash (same data, different predecessor => different hash)", () => {
    const [e] = buildChain(1);
    expect(computeCustodyEventHash({ ...e, previousEventHash: "f".repeat(64) })).not.toBe(e.eventHash);
  });

  it("uses a stable field order independent of object key order", () => {
    const [e] = buildChain(1);
    const reordered = Object.fromEntries(Object.entries(e).reverse()) as typeof e;
    expect(canonicalCustodyEvent(reordered)).toBe(canonicalCustodyEvent(e));
  });
});

describe("verifyCustodyChain", () => {
  it("verifies an intact chain (any input order) including its recorded head", () => {
    const chain = buildChain(6);
    const result = verifyCustodyChain([...chain].reverse(), { custodyHeadHash: chain[5].eventHash, custodyEventCount: 6 });
    expect(result.status).toBe("VERIFIED");
    expect(result.eventsChecked).toBe(6);
    expect(result.failures).toEqual([]);
  });

  it("detects an edited event and reports expected vs stored hash", () => {
    const chain = buildChain(4);
    chain[1] = { ...chain[1], reason: "Tampered reason" };
    const result = verifyCustodyChain(chain);
    expect(result.status).toBe("VIOLATION");
    const f = result.failures.find((x) => x.code === "HASH_MISMATCH")!;
    expect(f.sequence).toBe(2);
    expect(f.storedHash).toBe(chain[1].eventHash);
    expect(f.expectedHash).toBe(computeCustodyEventHash(chain[1]));
  });

  it("detects a re-hashed event through the broken link to its successor", () => {
    const chain = buildChain(4);
    const forged = { ...chain[1], reason: "Forged" };
    chain[1] = { ...forged, eventHash: computeCustodyEventHash(forged) };
    const result = verifyCustodyChain(chain);
    expect(result.status).toBe("VIOLATION");
    expect(result.failures.some((f) => f.code === "BROKEN_LINK" && f.sequence === 3)).toBe(true);
  });

  it("detects a deleted middle event", () => {
    const chain = buildChain(5);
    chain.splice(2, 1);
    const codes = verifyCustodyChain(chain).failures.map((f) => f.code);
    expect(codes).toContain("SEQUENCE_GAP");
    expect(codes).toContain("BROKEN_LINK");
  });

  it("detects a deleted trailing event via the evidence chain head", () => {
    const chain = buildChain(5);
    const head = { custodyHeadHash: chain[4].eventHash, custodyEventCount: 5 };
    const result = verifyCustodyChain(chain.slice(0, 4), head);
    expect(result.status).toBe("VIOLATION");
    expect(result.failures.map((f) => f.code)).toEqual(["HEAD_MISMATCH"]);
  });

  it("flags events that were never sealed", () => {
    const chain = buildChain(2);
    chain[0] = { ...chain[0], eventHash: null };
    expect(verifyCustodyChain(chain).failures.some((f) => f.code === "UNSEALED_EVENT")).toBe(true);
  });

  it("treats an empty chain with an empty head as verified", () => {
    expect(verifyCustodyChain([], { custodyHeadHash: null, custodyEventCount: 0 }).status).toBe("VERIFIED");
  });
});
