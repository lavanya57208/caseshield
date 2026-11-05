import { Router, Response } from "express";
import { authenticate, requireAuth } from "@/middleware/auth";
import { validate } from "@/middleware/validate";
import { PrivacyService } from "@/modules/privacy/privacy.service";
import {
  CreateRedactionSchema,
  CreateWatermarkSchema,
  DerivativeParamsSchema,
  DocumentIdParamsSchema,
  ScanParamsSchema,
  StartScanSchema,
} from "@/modules/privacy/privacy.schemas";

// Mounted under /api/documents alongside documents.routes.ts.
const router = Router();

export function sendFile(res: Response, file: { buffer: Buffer; fileName: string; mimeType: string }, disposition: "attachment" | "inline") {
  const safeName = file.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  res.setHeader("Content-Type", file.mimeType);
  res.setHeader("Content-Disposition", `${disposition}; filename="${safeName}"`);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(file.buffer);
}

router.post(
  "/:id/pii-scans",
  authenticate,
  requireAuth,
  validate(DocumentIdParamsSchema, "params"),
  validate(StartScanSchema),
  async (req, res, next) => {
    try {
      res.status(201).json({ scan: await PrivacyService.scan(req.user!, req.params.id, req.body.versionNumber, req.requestId) });
    } catch (err) {
      next(err);
    }
  },
);

router.get("/:id/pii-scans", authenticate, requireAuth, validate(DocumentIdParamsSchema, "params"), async (req, res, next) => {
  try {
    res.json({ scans: await PrivacyService.listScans(req.user!, req.params.id, req.requestId) });
  } catch (err) {
    next(err);
  }
});

router.get("/:id/pii-scans/:scanId", authenticate, requireAuth, validate(ScanParamsSchema, "params"), async (req, res, next) => {
  try {
    res.json({ scan: await PrivacyService.getScan(req.user!, req.params.id, req.params.scanId, req.requestId) });
  } catch (err) {
    next(err);
  }
});

router.post(
  "/:id/redactions",
  authenticate,
  requireAuth,
  validate(DocumentIdParamsSchema, "params"),
  validate(CreateRedactionSchema),
  async (req, res, next) => {
    try {
      const derivative = await PrivacyService.createRedaction(req.user!, req.params.id, req.body, req.requestId);
      res.status(derivative.status === "COMPLETED" ? 201 : 200).json({ derivative });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/:id/watermarks",
  authenticate,
  requireAuth,
  validate(DocumentIdParamsSchema, "params"),
  validate(CreateWatermarkSchema),
  async (req, res, next) => {
    try {
      const derivative = await PrivacyService.createWatermark(req.user!, req.params.id, req.body, req.requestId);
      res.status(derivative.status === "COMPLETED" ? 201 : 200).json({ derivative });
    } catch (err) {
      next(err);
    }
  },
);

router.get("/:id/derivatives", authenticate, requireAuth, validate(DocumentIdParamsSchema, "params"), async (req, res, next) => {
  try {
    res.json({ derivatives: await PrivacyService.listDerivatives(req.user!, req.params.id, req.requestId) });
  } catch (err) {
    next(err);
  }
});

router.get(
  "/:id/derivatives/:derivativeId/download",
  authenticate,
  requireAuth,
  validate(DerivativeParamsSchema, "params"),
  async (req, res, next) => {
    try {
      const file = await PrivacyService.downloadDerivative(req.user!, req.params.id, req.params.derivativeId, req.requestId);
      sendFile(res, file, "attachment");
    } catch (err) {
      next(err);
    }
  },
);

export default router;
