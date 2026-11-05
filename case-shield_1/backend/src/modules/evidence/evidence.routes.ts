import { Router, Request, Response, NextFunction } from "express";
import { authenticate, requireAuth } from "@/middleware/auth";
import { validate } from "@/middleware/validate";
import { EvidenceService } from "@/modules/evidence/evidence.service";
import {
  CandidatesQuerySchema,
  EvidenceActionSchema,
  IdParamsSchema,
  InitiateTransferSchema,
  ListEvidenceQuerySchema,
  RegisterEvidenceSchema,
  RejectTransferSchema,
  RespondTransferSchema,
  TransferParamsSchema,
} from "@/modules/evidence/evidence.schemas";

// Every route authenticates, validates its input, and delegates ALL
// authorization to EvidenceService (case access, confidentiality, custody
// rules, lifecycle). Actor identity and timestamps come from the server.

const router = Router();
const guard = [authenticate, requireAuth];

type Handler = (req: Request) => Promise<unknown>;
const handle =
  (fn: Handler, status = 200) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.status(status).json(await fn(req));
    } catch (err) {
      next(err);
    }
  };

router.get("/", ...guard, validate(ListEvidenceQuerySchema, "query"), handle((req) => EvidenceService.list(req.user!, req.query as any)));

router.post("/", ...guard, validate(RegisterEvidenceSchema), handle(async (req) => ({ evidence: await EvidenceService.register(req.user!, req.body, req.requestId) }), 201));

router.get(
  "/registration-candidates",
  ...guard,
  validate(CandidatesQuerySchema, "query"),
  handle((req) => EvidenceService.registrationCandidates(req.user!, req.query as any)),
);

router.get("/transfers/incoming", ...guard, handle(async (req) => ({ transfers: await EvidenceService.incomingTransfers(req.user!) })));

router.get("/:id", ...guard, validate(IdParamsSchema, "params"), handle(async (req) => ({ evidence: await EvidenceService.getById(req.user!, req.params.id, req.requestId) })));

router.get("/:id/custody", ...guard, validate(IdParamsSchema, "params"), handle((req) => EvidenceService.custodyTimeline(req.user!, req.params.id, req.requestId)));

router.get(
  "/:id/transfer-candidates",
  ...guard,
  validate(IdParamsSchema, "params"),
  handle(async (req) => ({ candidates: await EvidenceService.transferCandidates(req.user!, req.params.id, req.requestId) })),
);

router.post(
  "/:id/transfers",
  ...guard,
  validate(IdParamsSchema, "params"),
  validate(InitiateTransferSchema),
  handle(async (req) => ({ evidence: await EvidenceService.initiateTransfer(req.user!, req.params.id, req.body, req.requestId) }), 201),
);

router.post(
  "/:id/transfers/:transferId/accept",
  ...guard,
  validate(TransferParamsSchema, "params"),
  validate(RespondTransferSchema),
  handle(async (req) => ({ evidence: await EvidenceService.acceptTransfer(req.user!, req.params.id, req.params.transferId, req.body, req.requestId) })),
);

router.post(
  "/:id/transfers/:transferId/reject",
  ...guard,
  validate(TransferParamsSchema, "params"),
  validate(RejectTransferSchema),
  handle(async (req) => ({ evidence: await EvidenceService.rejectTransfer(req.user!, req.params.id, req.params.transferId, req.body, req.requestId) })),
);

router.post(
  "/:id/transfers/:transferId/cancel",
  ...guard,
  validate(TransferParamsSchema, "params"),
  validate(RejectTransferSchema),
  handle(async (req) => ({ evidence: await EvidenceService.cancelTransfer(req.user!, req.params.id, req.params.transferId, req.body, req.requestId) })),
);

router.post(
  "/:id/actions",
  ...guard,
  validate(IdParamsSchema, "params"),
  validate(EvidenceActionSchema),
  handle(async (req) => ({ evidence: await EvidenceService.performAction(req.user!, req.params.id, req.body, req.requestId) })),
);

router.post("/:id/verify-integrity", ...guard, validate(IdParamsSchema, "params"), handle((req) => EvidenceService.verifyIntegrity(req.user!, req.params.id, req.requestId)));

router.post("/:id/verify-custody", ...guard, validate(IdParamsSchema, "params"), handle((req) => EvidenceService.verifyCustodyChain(req.user!, req.params.id, req.requestId)));

export default router;
