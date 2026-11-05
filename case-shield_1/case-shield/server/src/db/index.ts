import fs from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";

const DATA_DIR = path.join(__dirname, "..", "..", "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, "case-shield.db");

// NOTE ON ARCHITECTURE:
// This module is the only place that speaks SQL storage. Every route calls
// the same query shapes that would run against Postgres in production. This
// prototype uses Node's built-in `node:sqlite` (zero external dependencies,
// bundled with Node 22.5+) so it runs with nothing to install. The real
// production data layer is PostgreSQL via Prisma (see /backend and /prisma
// at the repository root) - route and permission logic do not change.
export const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

export function initSchema() {
  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf-8");
  db.exec(schema);
}

export function isSeeded(): boolean {
  const row = db.prepare("SELECT COUNT(*) as c FROM users").get() as { c: number };
  return row.c > 0;
}
