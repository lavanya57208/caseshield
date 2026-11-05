// KeyManagementProvider — see docs/security-architecture.md §7. Not used
// directly to encrypt document bodies in this prototype (documents are
// stored as-is by the storage provider, with encryption-at-rest handled by
// the underlying platform — see docs/architecture.md §6), but modeled here
// so future envelope-encryption or signing work has a defined seam that
// never touches raw key material from the frontend.

export interface KeyManagementProvider {
  readonly name: string;
  /** Wrap (encrypt) a small piece of data, e.g. a per-object data key. */
  wrap(plaintext: Buffer): Promise<{ ciphertext: Buffer; keyRef: string }>;
  /** Unwrap previously wrapped data. */
  unwrap(ciphertext: Buffer, keyRef: string): Promise<Buffer>;
}
