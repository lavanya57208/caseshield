import express from "express";
import path from "node:path";
import helmet from "helmet";
import cors from "cors";
import compression from "compression";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";

import { env } from "@/config/env";
import { logger } from "@/lib/logger";
import { requestId } from "@/middleware/requestId";
import { errorHandler, notFoundHandler } from "@/middleware/error";

import authRoutes from "@/modules/auth/auth.routes";
import usersRoutes from "@/modules/users/users.routes";
import casesRoutes from "@/modules/cases/cases.routes";
import dashboardRoutes from "@/modules/cases/dashboard.routes";
import documentsRoutes from "@/modules/documents/documents.routes";
import evidenceRoutes from "@/modules/evidence/evidence.routes";
import accessRoutes from "@/modules/access/access.routes";
import auditRoutes from "@/modules/audit/audit.routes";
import notificationsRoutes from "@/modules/notifications/notifications.routes";
import searchRoutes from "@/modules/search/search.routes";
import aiRoutes from "@/modules/ai/ai.routes";
import intelligenceRoutes from "@/modules/ai/intelligence/intelligence.routes";
import securityRoutes from "@/modules/security/security.routes";
import privacyRoutes from "@/modules/privacy/privacy.routes";
import sharingRoutes from "@/modules/sharing/sharing.routes";

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  // Secure HTTP headers — see docs/security-architecture.md §3.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:"],
          connectSrc: ["'self'"],
        },
      },
      crossOriginResourcePolicy: { policy: "same-site" },
    }),
  );

  app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
  app.use(compression());
  app.use(cookieParser());
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as any).requestId,
      customLogLevel: (_req, res) => (res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "debug"),
      serializers: { req: (req) => ({ method: req.method, url: req.url }) },
    }),
  );

  // Global rate limiting — see docs/security-architecture.md §3. Login has
  // an additional, stricter limiter in auth.routes.ts.
  app.use(
    "/api",
    rateLimit({
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      limit: env.RATE_LIMIT_MAX,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", env: env.CASE_SHIELD_ENV, time: new Date().toISOString() });
  });

  app.use("/api/auth", authRoutes);
  app.use("/api/users", usersRoutes);
  app.use("/api/cases", casesRoutes);
  app.use("/api/dashboard", dashboardRoutes);
  app.use("/api/documents", documentsRoutes);
  app.use("/api/documents", privacyRoutes);
  app.use("/api/documents", intelligenceRoutes);
  app.use("/api/shares", sharingRoutes);
  app.use("/api/evidence", evidenceRoutes);
  app.use("/api/access-requests", accessRoutes);
  app.use("/api/audit", auditRoutes);
  app.use("/api/notifications", notificationsRoutes);
  app.use("/api/search", searchRoutes);
  app.use("/api/ai", aiRoutes);
  app.use("/api/security", securityRoutes);
  // Serve the built frontend
  const clientDist = path.resolve(process.cwd(), "case-shield", "client", "dist");
  app.use(express.static(clientDist));

  // SPA fallback — send index.html for frontend routes
  app.get("*", (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
  app.use("/api", notFoundHandler);
  app.use(errorHandler);

  return app;
}
