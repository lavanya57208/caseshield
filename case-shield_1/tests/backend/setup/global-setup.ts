import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";

// Prepares the isolated integration-test database: creates it if missing,
// applies all migrations, and empties every table. Refuses to touch any
// database whose name does not end in "_test".
export default async function setup() {
  const testUrl = process.env.CASE_SHIELD_TEST_DATABASE_URL!;
  const devUrl = process.env.DATABASE_URL;
  const dbName = decodeURIComponent(new URL(testUrl).pathname.replace(/^\//, ""));
  if (!dbName.endsWith("_test") || testUrl === devUrl) {
    throw new Error(`Refusing to run integration tests against "${dbName}": the test database name must end in "_test".`);
  }
  if (!/^[A-Za-z0-9_]+$/.test(dbName)) throw new Error(`Unexpected test database name "${dbName}".`);

  const maintenanceUrl = new URL(testUrl);
  maintenanceUrl.pathname = devUrl ? new URL(devUrl).pathname : "/postgres";
  const admin = new PrismaClient({ datasourceUrl: maintenanceUrl.toString() });
  try {
    const existing = await admin.$queryRawUnsafe<{ n: number }[]>(`SELECT 1 AS n FROM pg_database WHERE datname = $1`, dbName);
    if (existing.length === 0) await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
  } catch (err) {
    throw new Error(
      `Could not prepare the test database "${dbName}". Is PostgreSQL running and does the DATABASE_URL role have CREATEDB? (${(err as Error).message})`,
    );
  } finally {
    await admin.$disconnect();
  }

  const repoRoot = path.resolve(__dirname, "../../..");
  execSync("npx prisma migrate deploy --schema prisma/schema.prisma", {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL: testUrl },
    stdio: "pipe",
  });

  const db = new PrismaClient({ datasourceUrl: testUrl });
  try {
    const tables = await db.$queryRawUnsafe<{ tablename: string }[]>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
    );
    if (tables.length) {
      await db.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
    }
  } finally {
    await db.$disconnect();
  }

  const storageDir = process.env.CASE_SHIELD_TEST_STORAGE_DIR!;
  fs.rmSync(storageDir, { recursive: true, force: true });
  fs.mkdirSync(storageDir, { recursive: true });
}
