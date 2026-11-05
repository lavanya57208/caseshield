import { defineConfig } from "vitest/config";
import path from "path";
import os from "os";
import dotenv from "dotenv";

// Unit tests mock Prisma and need no database. Integration tests
// (tests/backend/integration) run the real Express app against an ISOLATED
// PostgreSQL database — never the development database. The test database
// URL is TEST_DATABASE_URL, or DATABASE_URL with "_test" appended to the
// database name. tests/backend/setup/global-setup.ts creates/migrates it.
dotenv.config({ path: path.resolve(__dirname, "../.env") });

function deriveTestDatabaseUrl(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const devUrl = process.env.DATABASE_URL;
  if (!devUrl) throw new Error("Set DATABASE_URL (or TEST_DATABASE_URL) in .env to run backend tests.");
  const url = new URL(devUrl);
  url.pathname = `/${url.pathname.replace(/^\//, "")}_test`;
  return url.toString();
}

const testDatabaseUrl = deriveTestDatabaseUrl();
const testStorageDir = path.join(os.tmpdir(), "case-shield-test-storage");
process.env.CASE_SHIELD_TEST_DATABASE_URL = testDatabaseUrl;
process.env.CASE_SHIELD_TEST_STORAGE_DIR = testStorageDir;

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "node",
    include: ["../tests/backend/**/*.test.ts"],
    globalSetup: ["../tests/backend/setup/global-setup.ts"],
    // Integration suites share one isolated test database (and seed shared
    // rows such as roles), so files run one at a time to avoid races.
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
    env: {
      NODE_ENV: "test",
      CASE_SHIELD_ENV: "development",
      DATABASE_URL: testDatabaseUrl,
      STORAGE_PROVIDER: "local",
      LOCAL_STORAGE_DIR: testStorageDir,
      RATE_LIMIT_MAX: "100000",
      AI_PROVIDER: "mock",
      OCR_PROVIDER: "mock",
      DOCUMENT_PROCESSING_MODE: "manual",
    },
  },
});
