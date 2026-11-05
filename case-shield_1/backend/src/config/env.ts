import { z } from "zod";
import dotenv from "dotenv";
import path from "path";

// Load .env from the repository root regardless of cwd.
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

const EnvSchema = z.object({
  CASE_SHIELD_ENV: z.enum(["development", "production"]).default("development"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(4000),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  JWT_SECRET: z.string().min(16, "JWT_SECRET must be set to a long random value"),
  JWT_EXPIRES_IN: z.string().default("8h"),

  LOCAL_STORAGE_DIR: z.string().default("./backend/storage-dev"),
  // Optional explicit override. When unset, the provider follows
  // CASE_SHIELD_ENV (development -> local, production -> gcs).
  STORAGE_PROVIDER: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["local", "gcs"]).optional()),

  // PII detection provider. Only the deterministic rules engine is
  // implemented; an AI/NLP provider can be added behind the same interface
  // (see backend/src/modules/privacy/pii/pii.types.ts).
  PII_PROVIDER: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["deterministic"]).default("deterministic")),
  // Key for HMAC fingerprints of detected PII values (never stored raw).
  // If unset, a key is derived from JWT_SECRET. Set a dedicated secret in
  // production (e.g. from Secret Manager).
  PII_FINGERPRINT_SECRET: z.string().optional().default(""),

  GOOGLE_CLOUD_PROJECT_ID: z.string().optional().default(""),
  GOOGLE_CLOUD_REGION: z.string().optional().default(""),
  GOOGLE_CLOUD_STORAGE_BUCKET: z.string().optional().default(""),
  GOOGLE_CLOUD_KMS_KEY_RING: z.string().optional().default(""),
  GOOGLE_CLOUD_KMS_KEY: z.string().optional().default(""),
  GOOGLE_APPLICATION_CREDENTIALS: z.string().optional().default(""),

  IDENTITY_PLATFORM_PROJECT_ID: z.string().optional().default(""),
  IDENTITY_PLATFORM_API_KEY: z.string().optional().default(""),

  SECRET_MANAGER_CONFIG: z.string().optional().default(""),

  AI_PROVIDER: z.enum(["mock", "vertex", "document-ai"]).default("mock"),
  AI_API_KEY: z.string().optional().default(""),

  // --- Phase 4: OCR / Vertex AI / processing pipeline ----------------------
  // OCR provider. When unset it follows AI_PROVIDER: "mock" -> mock OCR,
  // anything else -> Google Document AI. Mock OCR needs no credentials.
  OCR_PROVIDER: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["mock", "document-ai"]).optional()),
  DOCUMENT_AI_LOCATION: z.string().optional().default("us"),
  DOCUMENT_AI_PROCESSOR_ID: z.string().optional().default(""),
  VERTEX_AI_MODEL: z.string().optional().default("gemini-2.5-flash"),
  VERTEX_AI_EMBEDDING_MODEL: z.string().optional().default("text-embedding-005"),
  // "auto" runs queued processing jobs in the background right after upload.
  // "manual" only queues them (tests drain the queue explicitly).
  DOCUMENT_PROCESSING_MODE: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["auto", "manual"]).default("auto")),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(900000),
  RATE_LIMIT_MAX: z.coerce.number().default(300),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  throw new Error("Invalid environment configuration. Check .env against .env.example.");
}

export const env = parsed.data;
export const isDevelopment = env.CASE_SHIELD_ENV === "development";
export const isProduction = env.CASE_SHIELD_ENV === "production";
