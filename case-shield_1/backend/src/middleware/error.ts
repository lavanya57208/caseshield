import { Request, Response, NextFunction } from "express";
import { ApiError } from "@/lib/errors";
import { logger } from "@/lib/logger";

// Never leak stack traces or internal detail to clients — see
// docs/api.md §Error Shape and docs/security-architecture.md.
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ApiError) {
    if (err.statusCode >= 500) {
      logger.error({ err, requestId: req.requestId }, "Request failed with server error");
    } else {
      logger.warn(
        { code: err.code, requestId: req.requestId, path: req.path },
        "Request rejected",
      );
    }
    return res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        requestId: req.requestId,
      },
    });
  }

  logger.error({ err, requestId: req.requestId }, "Unhandled error");
  return res.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred.",
      requestId: req.requestId,
    },
  });
}

export function notFoundHandler(req: Request, res: Response) {
  return res.status(404).json({
    error: {
      code: "ROUTE_NOT_FOUND",
      message: `No route for ${req.method} ${req.path}.`,
      requestId: req.requestId,
    },
  });
}
