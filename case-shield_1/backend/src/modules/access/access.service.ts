import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/errors";
import { AuditService } from "@/modules/audit/audit.service";
import { NotificationsService } from "@/modules/notifications/notifications.service";
import { SecurityService } from "@/modules/security/security.service";
import { AuthenticatedUser } from "@/middleware/auth";
import { PERMISSIONS } from "@/lib/permissions";
import { z } from "zod";
import { CreateAccessRequestSchema, ListAccessRequestsQuerySchema } from "@/modules/access/access.schemas";

const APPROVER_ROLES = new Set(["SENIOR_INVESTIGATOR", "ADMIN"]);

export const AccessService = {
  async create(user: AuthenticatedUser, input: z.infer<typeof CreateAccessRequestSchema>, requestId: string) {
    const caseRecord = await prisma.case.findFirst({ where: { id: input.caseId, deletedAt: null } });
    if (!caseRecord) throw ApiError.notFound("Case");

    const created = await prisma.$transaction(async (tx) => {
      const reqRow = await tx.accessRequest.create({
        data: {
          caseId: input.caseId,
          documentId: input.documentId,
          requestedById: user.id,
          permissionKey: input.permissionKey,
          reason: input.reason,
          durationDays: input.durationDays,
        },
      });

      await AuditService.record(
        {
          actorId: user.id,
          actorRole: user.roles[0],
          action: "ACCESS_REQUESTED",
          resource: `access_request:${reqRow.id}`,
          caseId: input.caseId,
          documentId: input.documentId,
          result: "SUCCESS",
          requestId,
        },
        tx,
      );

      return reqRow;
    });

    const approvers = await prisma.user.findMany({
      where: {
        organizationId: user.organizationId,
        userRoles: { some: { role: { key: { in: Array.from(APPROVER_ROLES) } } } },
      },
    });
    await Promise.all(
      approvers.map((a) =>
        NotificationsService.send({
          userId: a.id,
          type: "ACCESS_REQUESTED",
          title: "New access request",
          body: `${user.fullName} requested ${input.permissionKey} on case ${caseRecord.caseNumber}.`,
          relatedCaseId: caseRecord.id,
        }),
      ),
    );

    return created;
  },

  async list(user: AuthenticatedUser, query: z.infer<typeof ListAccessRequestsQuerySchema>) {
    const isApprover = user.roles.some((r) => APPROVER_ROLES.has(r));
    const where = {
      status: query.status,
      caseId: query.caseId,
      ...(isApprover ? {} : { requestedById: user.id }),
    };
    const [items, total] = await Promise.all([
      prisma.accessRequest.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          requestedBy: { select: { fullName: true, email: true } },
          case: { select: { caseNumber: true, title: true } },
        },
      }),
      prisma.accessRequest.count({ where }),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  },

  async approve(user: AuthenticatedUser, id: string, reviewNote: string | undefined, requestId: string) {
    if (!user.roles.some((r) => APPROVER_ROLES.has(r))) {
      throw ApiError.forbidden("ACCESS_DENIED", "Only a Senior Investigator or Administrator may approve access requests.");
    }

    const reqRow = await prisma.accessRequest.findUnique({ where: { id }, include: { case: true } });
    if (!reqRow) throw ApiError.notFound("Access request");
    if (reqRow.status !== "PENDING") throw ApiError.conflict("ALREADY_REVIEWED", "This request has already been reviewed.");

    const permission = await prisma.permission.findUnique({ where: { key: reqRow.permissionKey } });
    if (!permission) throw ApiError.badRequest("UNKNOWN_PERMISSION", `Unknown permission key: ${reqRow.permissionKey}`);

    const expiresAt = reqRow.durationDays ? new Date(Date.now() + reqRow.durationDays * 24 * 60 * 60 * 1000) : undefined;

    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.accessRequest.update({
        where: { id },
        data: { status: "APPROVED", reviewedById: user.id, reviewedAt: new Date(), reviewNote, expiresAt },
      });

      if (reqRow.documentId) {
        await tx.documentPermission.create({
          data: {
            documentId: reqRow.documentId,
            userId: reqRow.requestedById,
            permissionId: permission.id,
            grantedBy: user.id,
            expiresAt,
          },
        });
      } else {
        await tx.casePermission.create({
          data: {
            caseId: reqRow.caseId,
            userId: reqRow.requestedById,
            permissionId: permission.id,
            grantedBy: user.id,
            expiresAt,
          },
        });
      }

      await AuditService.record(
        {
          actorId: user.id,
          actorRole: user.roles[0],
          action: "ACCESS_GRANTED",
          resource: `access_request:${id}`,
          caseId: reqRow.caseId,
          documentId: reqRow.documentId,
          result: "SUCCESS",
          requestId,
        },
        tx,
      );

      return updated;
    });

    await NotificationsService.send({
      userId: reqRow.requestedById,
      type: "ACCESS_APPROVED",
      title: "Access request approved",
      body: `Your request for ${reqRow.permissionKey} on case ${reqRow.case.caseNumber} was approved.`,
      relatedCaseId: reqRow.caseId,
    });

    return result;
  },

  async reject(user: AuthenticatedUser, id: string, reviewNote: string | undefined, requestId: string) {
    if (!user.roles.some((r) => APPROVER_ROLES.has(r))) {
      throw ApiError.forbidden("ACCESS_DENIED", "Only a Senior Investigator or Administrator may review access requests.");
    }
    const reqRow = await prisma.accessRequest.findUnique({ where: { id }, include: { case: true } });
    if (!reqRow) throw ApiError.notFound("Access request");
    if (reqRow.status !== "PENDING") throw ApiError.conflict("ALREADY_REVIEWED", "This request has already been reviewed.");

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.accessRequest.update({
        where: { id },
        data: { status: "REJECTED", reviewedById: user.id, reviewedAt: new Date(), reviewNote },
      });
      await AuditService.record(
        { actorId: user.id, actorRole: user.roles[0], action: "ACCESS_REVOKED", resource: `access_request:${id}`, caseId: reqRow.caseId, result: "SUCCESS", reason: "Rejected", requestId },
        tx,
      );
      return u;
    });

    await NotificationsService.send({
      userId: reqRow.requestedById,
      type: "ACCESS_REJECTED",
      title: "Access request rejected",
      body: `Your request for ${reqRow.permissionKey} on case ${reqRow.case.caseNumber} was rejected.${reviewNote ? " Reason: " + reviewNote : ""}`,
      relatedCaseId: reqRow.caseId,
    });

    return updated;
  },

  async revoke(user: AuthenticatedUser, id: string, requestId: string) {
    if (!user.roles.some((r) => APPROVER_ROLES.has(r))) {
      throw ApiError.forbidden("ACCESS_DENIED");
    }
    const reqRow = await prisma.accessRequest.findUnique({ where: { id } });
    if (!reqRow || reqRow.status !== "APPROVED") throw ApiError.conflict("NOT_ACTIVE", "This request is not an active grant.");

    await prisma.$transaction(async (tx) => {
      await tx.accessRequest.update({ where: { id }, data: { status: "REVOKED" } });
      if (reqRow.documentId) {
        await tx.documentPermission.updateMany({
          where: { documentId: reqRow.documentId, userId: reqRow.requestedById, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      } else {
        await tx.casePermission.updateMany({
          where: { caseId: reqRow.caseId, userId: reqRow.requestedById, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      await AuditService.record(
        { actorId: user.id, actorRole: user.roles[0], action: "ACCESS_REVOKED", resource: `access_request:${id}`, caseId: reqRow.caseId, result: "SUCCESS", requestId },
        tx,
      );
    });

    await SecurityService.record({
      type: "PERMISSION_CHANGE",
      userId: reqRow.requestedById,
      caseId: reqRow.caseId,
      severity: "LOW",
      detail: `Access grant for ${reqRow.permissionKey} was revoked by ${user.fullName}.`,
    });

    return { revoked: true };
  },
};
