import { db } from "../db";
import { id, now } from "./ids";
import { canonicalJson, chainHash } from "./hash";

export type AuditActor = { id: string; name: string; role: string } | null;

export interface WriteAuditParams {
  actor: AuditActor;
  action: string;
  resourceType?: string;
  resourceId?: string;
  caseId?: string | null;
  result: "Success" | "Failure" | "Denied";
  metadata?: Record<string, unknown>;
}

/**
 * Appends a tamper-evident audit event: event_hash = SHA256(previous_event_hash + canonical_event_data).
 * Every privileged operation in the API funnels through this function so the
 * System Audit Log and per-case Audit Trail are always complete.
 */
export function writeAudit(params: WriteAuditParams) {
  const last = db
    .prepare("SELECT event_hash FROM audit_events ORDER BY rowid DESC LIMIT 1")
    .get() as { event_hash: string } | undefined;
  const previousHash = last?.event_hash ?? null;

  const eventId = id();
  const timestamp = now();
  const metadata = params.metadata ?? {};

  const canonicalData = canonicalJson({
    id: eventId,
    event_timestamp: timestamp,
    actor_id: params.actor?.id ?? null,
    action: params.action,
    resource_type: params.resourceType ?? null,
    resource_id: params.resourceId ?? null,
    case_id: params.caseId ?? null,
    result: params.result,
    metadata,
  });

  const eventHash = chainHash(previousHash, canonicalData);

  db.prepare(
    `INSERT INTO audit_events
      (id, event_timestamp, actor_id, actor_name, role, action, resource_type, resource_id, case_id, result, metadata, previous_event_hash, event_hash)
     VALUES (@id, @event_timestamp, @actor_id, @actor_name, @role, @action, @resource_type, @resource_id, @case_id, @result, @metadata, @previous_event_hash, @event_hash)`
  ).run({
    id: eventId,
    event_timestamp: timestamp,
    actor_id: params.actor?.id ?? null,
    actor_name: params.actor?.name ?? "Unknown",
    role: params.actor?.role ?? null,
    action: params.action,
    resource_type: params.resourceType ?? null,
    resource_id: params.resourceId ?? null,
    case_id: params.caseId ?? null,
    result: params.result,
    metadata: JSON.stringify(metadata),
    previous_event_hash: previousHash,
    event_hash: eventHash,
  });

  return eventId;
}

/** Walks the full audit_events table in sequence order and recomputes each hash link. */
export function verifyAuditChain(): {
  verified: boolean;
  checkedEvents: number;
  firstBrokenEventId: string | null;
} {
  const rows = db
    .prepare("SELECT * FROM audit_events ORDER BY rowid ASC")
    .all() as any[];

  let previousHash: string | null = null;
  for (const row of rows) {
    const canonicalData = canonicalJson({
      id: row.id,
      event_timestamp: row.event_timestamp,
      actor_id: row.actor_id,
      action: row.action,
      resource_type: row.resource_type,
      resource_id: row.resource_id,
      case_id: row.case_id,
      result: row.result,
      metadata: row.metadata ? JSON.parse(row.metadata) : {},
    });
    const expected = chainHash(previousHash, canonicalData);
    if (expected !== row.event_hash) {
      return { verified: false, checkedEvents: rows.length, firstBrokenEventId: row.id };
    }
    previousHash = row.event_hash;
  }
  return { verified: true, checkedEvents: rows.length, firstBrokenEventId: null };
}
