import crypto from "crypto";

export function id(): string {
  return crypto.randomUUID();
}

export function now(): string {
  return new Date().toISOString();
}
