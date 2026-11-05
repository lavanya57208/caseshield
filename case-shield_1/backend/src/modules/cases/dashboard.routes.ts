import { Router } from "express";
import { authenticate, requireAuth } from "@/middleware/auth";
import { prisma } from "@/lib/prisma";

const router = Router();

const OVERSIGHT_ROLES = new Set(["ADMIN", "AUDITOR"]);

// Aggregates the data behind the role-aware dashboard described in
// docs/product-requirements.md §6. Every query below is scoped to cases the
// caller can actually see, using the same visibility rule as cases.service.
router.get("/", authenticate, requireAuth, async (req, res, next) => {
  try {
    const user = req.user!;
    const isOversight = user.roles.some((r) => OVERSIGHT_ROLES.has(r));
    const caseVisibility = isOversight
      ? {}
      : {
          OR: [
            { investigatingOfficerId: user.id },
            { assignments: { some: { userId: user.id } } },
            { permissions: { some: { OR: [{ userId: user.id }, { roleId: { in: user.roleIds } }], revokedAt: null } } },
          ],
        };

    const baseWhere = { organizationId: user.organizationId, deletedAt: null, ...caseVisibility };

    const [
      casesByStatus,
      activeCases,
      recentCases,
      myPendingAccessRequests,
      approvableAccessRequests,
      recentAudit,
      integrityViolations,
      unreadNotifications,
      documentCount,
      pendingTransfers,
    ] = await Promise.all([
        prisma.case.groupBy({ by: ["status"], where: baseWhere, _count: true }),
        prisma.case.count({ where: { ...baseWhere, status: "ACTIVE" } }),
        prisma.case.findMany({
          where: baseWhere,
          orderBy: { lastActivityAt: "desc" },
          take: 6,
          include: { category: true, type: true, _count: { select: { documents: true, evidence: true } } },
        }),
        prisma.accessRequest.count({ where: { requestedById: user.id, status: "PENDING" } }),
        user.roles.some((r) => ["SENIOR_INVESTIGATOR", "ADMIN"].includes(r))
          ? prisma.accessRequest.count({ where: { status: "PENDING" } })
          : Promise.resolve(0),
        prisma.auditEvent.findMany({
          where: isOversight ? {} : { actorId: user.id },
          orderBy: { occurredAt: "desc" },
          take: 20,
          include: { actor: { select: { fullName: true } }, case: { select: { caseNumber: true } } },
        }),
        prisma.documentVersion.count({ where: { integrityStatus: "VIOLATION" } }),
        prisma.notification.count({ where: { userId: user.id, isRead: false } }),
        prisma.document.count({ where: { deletedAt: null, case: baseWhere } }),
        // Evidence handed to this user that still awaits their receipt.
        prisma.evidenceTransfer.count({ where: { toCustodianId: user.id, status: "PENDING" } }),
      ]);

    res.json({
      casesByStatus,
      activeCases,
      recentCases,
      myPendingAccessRequests,
      approvableAccessRequests,
      recentAudit,
      integrityViolations,
      unreadNotifications,
      documentCount,
      pendingTransfers,
      pendingActions: pendingTransfers + (user.roles.some((r) => ["SENIOR_INVESTIGATOR", "ADMIN"].includes(r)) ? approvableAccessRequests : myPendingAccessRequests),
      roles: user.roles,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
