import pino from "pino";
import { env } from "@/config/env";

// Structured logging only. Never log passwords, tokens, private keys, or
// full sensitive document contents — see docs/security-architecture.md §Audit.
export const logger = pino({
  level: env.NODE_ENV === "test" ? "silent" : env.NODE_ENV === "production" ? "info" : "debug",
  redact: {
    paths: [
      "req.headers.authorization",
      "password",
      "passwordHash",
      "token",
      "*.password",
      "*.passwordHash",
      "*.token",
    ],
    censor: "[REDACTED]",
  },
  transport:
    env.NODE_ENV === "development"
      ? { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss" } }
      : undefined,
});
