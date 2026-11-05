import crypto from "crypto";

// Hash-linked custody timeline — see docs/security-architecture.md
// §"Chain of Custody".
//
//   event1.eventHash = H(canonical(event1, previousEventHash = null))
//   eventN.eventHash = H(canonical(eventN, previousEventHash = eventN-1.eventHash))
//
// This is an APPLICATION-LEVEL tamper-evidence mechanism, not a blockchain:
// editing, reordering or deleting a stored event breaks the linkage and is
// detected by verifyCustodyChain(). It cannot stop someone with direct
// database write access from rewriting the whole chain consistently — the
// optional future Hyperledger Fabric layer would anchor chain heads outside
// the application database for that.
//
// Kept free of "@/..." imports so prisma/seed.ts can reuse it directly.

export const CUSTODY_HASH_VERSION = 1;

export interface CustodyEventHashInput {
  evidenceId: string;
  sequence: number;
  action: string;
  fromUserId: string | null;
  toUserId: string | null;
  actorId: string;
  organizationId: string;
  transferId: string | null;
  reason: string;
  notes: string | null;
  location: string | null;
  hashAtEvent: string | null;
  occurredAt: Date;
  previousEventHash: string | null;
}

export interface StoredCustodyEvent extends CustodyEventHashInput {
  id: string;
  eventHash: string | null;
}

/**
 * Deterministic serialization: a fixed-order array (never object key
 * order), explicit nulls, and millisecond ISO timestamps (the precision
 * PostgreSQL TIMESTAMP(3) stores), so the same row always hashes the same.
 */
export function canonicalCustodyEvent(e: CustodyEventHashInput): string {
  return JSON.stringify([
    ["v", CUSTODY_HASH_VERSION],
    ["evidenceId", e.evidenceId],
    ["sequence", e.sequence],
    ["action", e.action],
    ["fromUserId", e.fromUserId ?? null],
    ["toUserId", e.toUserId ?? null],
    ["actorId", e.actorId],
    ["organizationId", e.organizationId],
    ["transferId", e.transferId ?? null],
    ["reason", e.reason],
    ["notes", e.notes ?? null],
    ["location", e.location ?? null],
    ["hashAtEvent", e.hashAtEvent ?? null],
    ["occurredAt", new Date(e.occurredAt).toISOString()],
    ["previousEventHash", e.previousEventHash ?? null],
  ]);
}

export function computeCustodyEventHash(e: CustodyEventHashInput): string {
  const payload = `${e.previousEventHash ?? ""}\n${canonicalCustodyEvent(e)}`;
  return crypto.createHash("sha256").update(payload, "utf8").digest("hex");
}

export type CustodyChainFailureCode =
  | "UNSEALED_EVENT" // stored without a hash (legacy row never sealed)
  | "SEQUENCE_GAP" // an event is missing or out of order
  | "BROKEN_LINK" // previousEventHash does not match the prior event's hash
  | "HASH_MISMATCH" // stored eventHash differs from the recomputed hash
  | "HEAD_MISMATCH"; // evidence's recorded chain head/count disagrees (truncation)

export interface CustodyChainFailure {
  code: CustodyChainFailureCode;
  eventId: string | null;
  sequence: number | null;
  expectedHash: string | null;
  storedHash: string | null;
  message: string;
}

export interface CustodyChainVerification {
  status: "VERIFIED" | "VIOLATION";
  eventsChecked: number;
  headHash: string | null;
  failures: CustodyChainFailure[];
}

/**
 * Verifies a full custody chain. `events` may arrive in any order; they are
 * checked in `sequence` order. `head` is the chain head recorded on the
 * evidence row — when supplied, a deleted trailing event is also detected.
 */
export function verifyCustodyChain(
  events: StoredCustodyEvent[],
  head?: { custodyHeadHash: string | null; custodyEventCount: number },
): CustodyChainVerification {
  const ordered = [...events].sort((a, b) => a.sequence - b.sequence);
  const failures: CustodyChainFailure[] = [];
  let previousStored: string | null = null;

  ordered.forEach((event, index) => {
    const expectedSequence = index + 1;
    if (event.sequence !== expectedSequence) {
      failures.push({
        code: "SEQUENCE_GAP",
        eventId: event.id,
        sequence: event.sequence,
        expectedHash: null,
        storedHash: null,
        message: `Expected custody event #${expectedSequence} but found #${event.sequence}; an event may have been removed.`,
      });
    }

    if (!event.eventHash) {
      failures.push({
        code: "UNSEALED_EVENT",
        eventId: event.id,
        sequence: event.sequence,
        expectedHash: null,
        storedHash: null,
        message: `Custody event #${event.sequence} has no stored hash.`,
      });
    }

    if ((event.previousEventHash ?? null) !== previousStored) {
      failures.push({
        code: "BROKEN_LINK",
        eventId: event.id,
        sequence: event.sequence,
        expectedHash: previousStored,
        storedHash: event.previousEventHash ?? null,
        message: `Custody event #${event.sequence} does not link to the preceding event.`,
      });
    }

    if (event.eventHash) {
      const recomputed = computeCustodyEventHash(event);
      if (recomputed !== event.eventHash) {
        failures.push({
          code: "HASH_MISMATCH",
          eventId: event.id,
          sequence: event.sequence,
          expectedHash: recomputed,
          storedHash: event.eventHash,
          message: `Custody event #${event.sequence} does not match its recorded hash; its data has changed since it was recorded.`,
        });
      }
    }

    previousStored = event.eventHash ?? null;
  });

  const lastHash = ordered.length ? ordered[ordered.length - 1].eventHash ?? null : null;
  if (head && (head.custodyEventCount !== ordered.length || (head.custodyHeadHash ?? null) !== lastHash)) {
    failures.push({
      code: "HEAD_MISMATCH",
      eventId: null,
      sequence: head.custodyEventCount,
      expectedHash: head.custodyHeadHash ?? null,
      storedHash: lastHash,
      message: `The evidence record expects ${head.custodyEventCount} custody event(s) ending in its recorded chain head, but ${ordered.length} were found.`,
    });
  }

  return { status: failures.length ? "VIOLATION" : "VERIFIED", eventsChecked: ordered.length, headHash: lastHash, failures };
}
