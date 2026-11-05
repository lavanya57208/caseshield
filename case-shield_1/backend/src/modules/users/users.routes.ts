import { Router } from "express";
import { z } from "zod";
import { authenticate, requireAuth } from "@/middleware/auth";
import { requirePermission } from "@/middleware/authorize";
import { validate } from "@/middleware/validate";
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/errors";
import { AuditService } from "@/modules/audit/audit.service";

const router = Router();

router.get("/", authenticate, requireAuth, requirePermission(PERMISSIONS.ADMIN_MANAGE), async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      where: { organizationId: req.user!.organizationId, deletedAt: null },
      include: { userRoles: { include: { role: true } } },
      orderBy: { fullName: "asc" },
    });
    res.json({
      users: users.map((u) => ({
        id: u.id,
        email: u.email,
        fullName: u.fullName,
        department: u.department,
        officialIdentifier: u.officialIdentifier,
        status: u.status,
        roles: u.userRoles.map((ur) => ur.role.key),
        lastLoginAt: u.lastLoginAt,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/:id", authenticate, requireAuth, async (req, res, next) => {
  try {
    const user = await prisma.user.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId, deletedAt: null },
      include: { userRoles: { include: { role: true } } },
    });
    if (!user) throw ApiError.notFound("User");
    res.json({
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        department: user.department,
        officialIdentifier: user.officialIdentifier,
        status: user.status,
        roles: user.userRoles.map((ur) => ur.role.key),
      },
    });
  } catch (err) {
    next(err);
  }
});

const UpdateUserSchema = z.object({
  fullName: z.string().min(1).optional(),
  department: z.string().optional(),
  status: z.enum(["ACTIVE", "SUSPENDED", "DISABLED"]).optional(),
});

router.patch(
  "/:id",
  authenticate,
  requireAuth,
  requirePermission(PERMISSIONS.ADMIN_MANAGE),
  validate(UpdateUserSchema),
  async (req, res, next) => {
    try {
      const target = await prisma.user.findFirst({ where: { id: req.params.id, organizationId: req.user!.organizationId } });
      if (!target) throw ApiError.notFound("User");

      const updated = await prisma.user.update({ where: { id: target.id }, data: req.body });

      await AuditService.record({
        actorId: req.user!.id,
        actorRole: req.user!.roles[0],
        action: "PROFILE_CHANGED",
        resource: `user:${target.id}`,
        result: "SUCCESS",
        requestId: req.requestId,
      });

      res.json({ user: { id: updated.id, fullName: updated.fullName, status: updated.status } });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
