import { Router } from "express";
import multer from "multer";
import { authenticate, requireAuth } from "@/middleware/auth";
import { validate } from "@/middleware/validate";
import { ApiError } from "@/lib/errors";
import { DocumentsService } from "@/modules/documents/documents.service";
import {
  UploadDocumentMetaSchema,
  NewVersionMetaSchema,
  VerifyQuerySchema,
  ListDocumentsQuerySchema,
} from "@/modules/documents/documents.schemas";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });
const router = Router();

router.get("/", authenticate, requireAuth, validate(ListDocumentsQuerySchema, "query"), async (req, res, next) => {
  try {
    res.json(await DocumentsService.list(req.user!, req.query as any));
  } catch (err) {
    next(err);
  }
});

router.post(
  "/",
  authenticate,
  requireAuth,
  upload.single("file"),
  async (req, res, next) => {
    try {
      if (!req.file) throw ApiError.badRequest("FILE_REQUIRED", "A file must be attached to this request.");
      const meta = UploadDocumentMetaSchema.parse(req.body);
      const document = await DocumentsService.upload(
        req.user!,
        meta,
        {
          originalname: req.file.originalname,
          mimetype: req.file.mimetype,
          size: req.file.size,
          buffer: req.file.buffer,
        },
        req.requestId,
      );
      res.status(201).json({ document });
    } catch (err) {
      next(err);
    }
  },
);

router.get("/:id", authenticate, requireAuth, async (req, res, next) => {
  try {
    res.json({ document: await DocumentsService.getById(req.user!, req.params.id, req.requestId) });
  } catch (err) {
    next(err);
  }
});

router.get("/:id/versions", authenticate, requireAuth, async (req, res, next) => {
  try {
    res.json({ versions: await DocumentsService.versions(req.user!, req.params.id) });
  } catch (err) {
    next(err);
  }
});

router.post("/:id/versions", authenticate, requireAuth, upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) throw ApiError.badRequest("FILE_REQUIRED", "A file must be attached to this request.");
    const meta = NewVersionMetaSchema.parse(req.body);
    const version = await DocumentsService.addVersion(
      req.user!,
      req.params.id,
      meta.changeNote,
      { originalname: req.file.originalname, mimetype: req.file.mimetype, size: req.file.size, buffer: req.file.buffer },
      req.requestId,
    );
    res.status(201).json({ version });
  } catch (err) {
    next(err);
  }
});

router.get("/:id/download", authenticate, requireAuth, async (req, res, next) => {
  try {
    const { buffer, fileName, mimeType } = await DocumentsService.download(req.user!, req.params.id, req.requestId);
    res.setHeader("Content-Type", mimeType);
    res.setHeader("Content-Disposition", `attachment; filename="${fileName.replace(/"/g, "")}"`);
    res.send(buffer);
  } catch (err) {
    next(err);
  }
});

router.post("/:id/verify", authenticate, requireAuth, validate(VerifyQuerySchema, "query"), async (req, res, next) => {
  try {
    const q = req.query as unknown as { versionNumber?: number };
    res.json(await DocumentsService.verify(req.user!, req.params.id, q.versionNumber, req.requestId));
  } catch (err) {
    next(err);
  }
});

export default router;
