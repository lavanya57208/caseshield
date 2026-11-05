import crypto from "crypto";

/** Real SHA-256 over a file buffer. Used for document integrity registration/verification. */
export function sha256Buffer(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

/**
 * Canonicalize an object to a stable JSON string (sorted keys) so that the
 * audit hash chain is reproducible regardless of key insertion order.
 */
export function canonicalJson(obj: Record<string, unknown>): string {
  const sortedKeys = Object.keys(obj).sort();
  const sorted: Record<string, unknown> = {};
  for (const k of sortedKeys) sorted[k] = obj[k];
  return JSON.stringify(sorted);
}

/** event_hash = SHA256(previous_event_hash + canonical_event_data) */
export function chainHash(previousHash: string | null, canonicalData: string): string {
  return crypto
    .createHash("sha256")
    .update((previousHash ?? "GENESIS") + canonicalData)
    .digest("hex");
}
