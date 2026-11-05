import { Request, Response, NextFunction } from "express";
import { ZodTypeAny } from "zod";
import { ApiError } from "@/lib/errors";

type Target = "body" | "query" | "params";

export function validate(schema: ZodTypeAny, target: Target = "body") {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[target]);
    if (!result.success) {
      return next(
        ApiError.badRequest(
          "VALIDATION_ERROR",
          "The request did not pass validation.",
          result.error.flatten(),
        ),
      );
    }
    (req as any)[target] = result.data;
    next();
  };
}
