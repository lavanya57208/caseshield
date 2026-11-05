import { PrismaClient } from "@prisma/client";

// Single shared Prisma client for the whole modular monolith.
// See docs/architecture.md — one database, one storage abstraction.
export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
});
