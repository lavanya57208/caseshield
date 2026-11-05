import { createApp } from "@/app";
import { env } from "@/config/env";
import { logger } from "@/lib/logger";
import { IntelligenceService } from "@/modules/ai/intelligence/intelligence.service";

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info(`Case Shield API listening on port ${env.PORT} (${env.CASE_SHIELD_ENV} mode)`);
  // The in-process queue is not durable: pick up jobs left queued by a restart.
  // Retried briefly: the database may still be accepting connections at boot.
  if (env.DOCUMENT_PROCESSING_MODE === "auto") {
    const resume = (attempt: number) =>
      IntelligenceService.resumePendingJobs()
        .then((n) => n && logger.info(`Resumed ${n} queued document-processing job(s).`))
        .catch((err) => {
          if (attempt < 5) return void setTimeout(() => resume(attempt + 1), attempt * 2000);
          logger.error({ err: (err as Error).message }, "failed to resume document-processing jobs");
        });
    resume(1);
  }
});

function shutdown(signal: string) {
  logger.info(`Received ${signal}, shutting down gracefully.`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
