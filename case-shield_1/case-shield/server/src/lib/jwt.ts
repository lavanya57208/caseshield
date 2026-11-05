import crypto from "crypto";

/**
 * Minimal HMAC-SHA256 signed session token (a hand-rolled JWT-alike, header.payload.signature
 * using base64url), built entirely on Node's crypto module so authentication has zero external
 * dependencies. Same shape and guarantees as a JWT: tamper-evident, server-signed, expiring.
 */
const SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;

export interface TokenPayload {
  sub: string; // user id
  role: string;
  name: string;
  iat: number;
  exp: number;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

export function signToken(payload: Omit<TokenPayload, "iat" | "exp">): string {
  const iat = Date.now();
  const full: TokenPayload = { ...payload, iat, exp: iat + EIGHT_HOURS_MS };
  const body = base64url(JSON.stringify(full));
  const sig = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyToken(token: string): TokenPayload {
  const [body, sig] = token.split(".");
  if (!body || !sig) throw new Error("Malformed token");
  const expectedSig = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error("Invalid token signature");
  }
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf-8")) as TokenPayload;
  if (Date.now() > payload.exp) throw new Error("Token expired");
  return payload;
}
