// StorageProvider — see docs/architecture.md §6. Business logic depends
// only on this interface, never on a concrete cloud SDK.

export interface StoredObjectRef {
  provider: "local" | "gcs";
  key: string;
}

export interface StorageProvider {
  /** Persist a buffer under a server-generated key; never trust a client-supplied path. */
  put(key: string, data: Buffer, contentType: string): Promise<StoredObjectRef>;
  /** Retrieve the raw bytes for integrity verification / controlled download. */
  get(key: string): Promise<Buffer>;
  /** True if the object exists (used before destructive or overwrite-adjacent ops). */
  exists(key: string): Promise<boolean>;
  /** Human-readable name for audit/logging context. */
  readonly name: string;
  /** Stable identifier persisted alongside storage keys. */
  readonly id: "local" | "gcs";
}

// Derived objects (redacted / watermarked copies) live beside the original
// under a separate prefix and are never written over an original key:
//   cases/{caseId}/{documentId}/derived/{kind}/{derivativeId}/{fileName}
export function buildDerivativeStorageKey(
  caseId: string,
  documentId: string,
  kind: "redacted" | "watermarked",
  derivativeId: string,
  fileName: string,
): string {
  return buildStorageKey(caseId, documentId, `derived/${kind}/${derivativeId}`, fileName);
}

export function buildStorageKey(caseId: string, documentOrEvidenceId: string, versionOrSuffix: string, fileName: string): string {
  const safeFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `cases/${caseId}/${documentOrEvidenceId}/${versionOrSuffix}/${safeFileName}`;
}
