import { Request, Response, NextFunction } from "express";
import { ApiError } from "@/lib/errors";
import { PermissionKey, ROLE_BASELINE_PERMISSIONS } from "@/lib/permissions";
import { AuditService } from "@/modules/audit/audit.service";

/**
 * Global, non-case-scoped permission gate (e.g. admin.manage, audit.view at
 * the collection level). Case- and document-scoped checks go through
 * lib/authorization.ts#can(), called from the owning service, because they
 * need the specific case/document record loaded first.
 */
export function requirePermission(permission: PermissionKey) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(ApiError.unauthorized());

    const allowed = req.user.roles.some((role) => (ROLE_BASELINE_PERMISSIONS[role] ?? []).includes(permission));

    if (!allowed) {
      await AuditService.record({
        actorId: req.user.id,
        actorRole: req.user.roles[0] ?? null,
        action: "PERMISSION_DENIED",
        resource: permission,
        result: "DENIED",
        reason: `Missing permission ${permission}`,
        requestId: req.requestId,
      });
      return next(ApiError.forbidden("ACCESS_DENIED", "You do not have permission to perform this action."));
    }
    next();
  };
}
