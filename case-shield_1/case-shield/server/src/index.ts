import path from "path";
import { loadEnv } from "./lib/loadEnv";
import { createApp, serveStatic } from "./lib/miniserver";
import { seed } from "./db/seed";

loadEnv();

import authRoutes from "./routes/auth";
import referenceRoutes from "./routes/reference";
import caseRoutes from "./routes/cases";
import documentRoutes from "./routes/documents";
import evidenceRoutes from "./routes/evidence";
import accessRequestRoutes from "./routes/accessRequests";
import auditRoutes from "./routes/audit";
import searchRoutes from "./routes/search";
import dashboardRoutes from "./routes/dashboard";
import notificationRoutes from "./routes/notifications";
import userRoutes from "./routes/users";
import ledgerRoutes from "./routes/ledger";

seed();

const app = createApp();

// Basic security headers (a production deployment should also sit behind
// TLS-terminating infrastructure and a CDN/WAF).
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});

// Extremely simple in-memory rate limiter (per IP) - illustrative only.
const hits = new Map<string, { count: number; windowStart: number }>();
app.use((req, res, next) => {
  const key = req.ip || "unknown";
  const windowMs = 60_000;
  const limit = 300;
  const entry = hits.get(key);
  const nowMs = Date.now();
  if (!entry || nowMs - entry.windowStart > windowMs) {
    hits.set(key, { count: 1, windowStart: nowMs });
  } else {
    entry.count += 1;
    if (entry.count > limit) {
      res.status(429).json({ error: "Too many requests. Please slow down." });
      return;
    }
  }
  next();
});

app.get("/api/health", (_req, res) => res.json({ ok: true, service: "case-shield-api" }));

app.use("/api/auth", authRoutes);
app.use("/api/reference", referenceRoutes);
app.use("/api/cases", caseRoutes);
app.use("/api/documents", documentRoutes);
app.use("/api/evidence", evidenceRoutes);
app.use("/api/access-requests", accessRequestRoutes);
app.use("/api/audit", auditRoutes);
app.use("/api/search", searchRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/users", userRoutes);
app.use("/api/integrity-ledger", ledgerRoutes);

// Serve the built frontend (see /client) so the whole app runs as a single
// process on a single port with no CORS to configure.
const CLIENT_DIST = path.join(__dirname, "..", "..", "client", "dist");
app.use(serveStatic(CLIENT_DIST));

const PORT = Number(process.env.PORT) || 4000;
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Case Shield running on http://localhost:${PORT}`);
});
