import crypto from "crypto";

/**
 * Password hashing using Node's built-in scrypt (no external dependency).
 * Format: scrypt$<saltHex>$<hashHex> - deliberately similar in spirit to
 * bcrypt's self-describing hash strings so this module is a drop-in swap for
 * a bcrypt/argon2 library in a production deployment.
 */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1], "hex");
  const expected = Buffer.from(parts[2], "hex");
  const actual = crypto.scryptSync(password, salt, 64);
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}
