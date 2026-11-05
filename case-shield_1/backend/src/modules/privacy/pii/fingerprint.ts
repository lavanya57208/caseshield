import crypto from "crypto";
import { env } from "@/config/env";
import { PiiType } from "@/modules/privacy/pii/pii.types";

// Keyed fingerprints let the system recognise "the same value" across a
// scan and a later redaction without storing the value. A plain SHA-256
// would be brute-forceable for short numeric identifiers (12 digits), so
// this is an HMAC under a server-side key that is never hardcoded.
let cachedKey: Buffer | undefined;

function fingerprintKey(): Buffer {
  if (!cachedKey) {
    cachedKey = env.PII_FINGERPRINT_SECRET
      ? Buffer.from(env.PII_FINGERPRINT_SECRET, "utf-8")
      : crypto.createHmac("sha256", env.JWT_SECRET).update("case-shield:pii-fingerprint:v1").digest();
  }
  return cachedKey;
}

export function piiFingerprint(type: PiiType, normalizedValue: string): string {
  return crypto.createHmac("sha256", fingerprintKey()).update(`${type}:${normalizedValue}`).digest("hex");
}
