import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/errors";
import { generateCaseNumber } from "@/lib/ids";
import { AuditService } from "@/modules/audit/audit.service";
import { AuthenticatedUser } from "@/middleware/auth";
import { can, hasCaseAccess } from "@/lib/authorization";
import { PERMISSIONS } from "@/lib/permissions";
import { z } from "zod";
import { CreateCaseSchema, UpdateCaseSchema, AssignCaseSchema, ListCasesQuerySchema } from "@/modules/cases/cases.schemas";

const OVERSIGHT_ROLES = new Set(["ADMIN", "AUDITOR"]);
// Roles that may be named investigating officer on a case.
const OFFICER_ROLES = ["INVESTIGATOR", "SENIOR_INVESTIGATOR"];

async function assertTypeInCategory(categoryId: string, typeId: string) {
  const type = await prisma.caseType.findUnique({ where: { id: typeId } });
  if (!type || type.categoryId !== categoryId) {
    throw ApiError.badRequest("INVALID_CASE_TYPE", "The selected case type does not belong to the selected category.");
  }
}

async function assertAssignableOfficer(user: AuthenticatedUser, officerId: string) {
  const officer = await prisma.user.findFirst({
    where: { id: officerId, organizationId: user.organizationId, status: "ACTIVE", deletedAt: null, userRoles: { some: { role: { key: { in: OFFICER_ROLES } } } } },
  });
  if (!officer) throw ApiError.badRequest("INVALID_OFFICER", "The selected investigating officer is not an active investigator in your organization.");
}

export const CasesService = {
  async listCategories() {
    return prisma.caseCategory.findMany({ orderBy: { sortOrder: "asc" }, include: { types: { orderBy: { sortOrder: "asc" } } } });
  },

  async list(user: AuthenticatedUser, query: z.infer<typeof ListCasesQuerySchema>) {
    const visibilityFilter = user.roles.some((r) => OVERSIGHT_ROLES.has(r))
      ? {}
      : {
          OR: [
            { investigatingOfficerId: user.id },
            { assignments: { some: { userId: user.id } } },
            { permissions: { some: { OR: [{ userId: user.id }, { roleId: { in: user.roleIds } }], revokedAt: null } } },
          ],
        };

    const where = {
      organizationId: user.organizationId,
      deletedAt: null,
      status: query.status,
      priority: query.priority,
      categoryId: query.categoryId,
      court: query.court ? { contains: query.court, mode: "insensitive" as const } : undefined,
      title: query.q ? { contains: query.q, mode: "insensitive" as const } : undefined,
      ...visibilityFilter,
    };

    const [items, total] = await Promise.all([
      prisma.case.findMany({
        where,
        orderBy: { lastActivityAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          category: true,
          type: true,
          investigatingOfficer: { select: { id: true, fullName: true } },
          _count: { select: { documents: true, evidence: true } },
        },
      }),
      prisma.case.count({ where }),
    ]);

    return { items, total, page: query.page, pageSize: query.pageSize };
  },

  /** Next free case number, shown as the form default. Not reserved. */
  async suggestCaseNumber() {
    return generateCaseNumber();
  },

  /** Active investigators in the caller's organization — id, name and role only. */
  async assignableOfficers(user: AuthenticatedUser) {
    const users = await prisma.user.findMany({
      where: { organizationId: user.organizationId, status: "ACTIVE", deletedAt: null, userRoles: { some: { role: { key: { in: OFFICER_ROLES } } } } },
      orderBy: { fullName: "asc" },
      select: { id: true, fullName: true, department: true, userRoles: { select: { role: { select: { key: true, name: true } } } } },
    });
    return users.map((u) => ({ id: u.id, fullName: u.fullName, department: u.department, role: u.userRoles[0]?.role.name ?? "" }));
  },

  async create(user: AuthenticatedUser, input: z.infer<typeof CreateCaseSchema>, requestId: string) {
    await assertTypeInCategory(input.categoryId, input.typeId);
    const officerId = input.investigatingOfficerId ?? user.id;
    if (officerId !== user.id) await assertAssignableOfficer(user, officerId);

    let caseNumber = input.caseNumber;
    if (caseNumber) {
      if (await prisma.case.findUnique({ where: { caseNumber } })) {
        throw ApiError.conflict("CASE_NUMBER_TAKEN", `${caseNumber} is already in use. Choose a different case number.`);
      }
    } else {
      caseNumber = await generateCaseNumber();
    }

    const created = await prisma.$transaction(async (tx) => {
      const c = await tx.case.create({
        data: {
          caseNumber,
          title: input.title,
          categoryId: input.categoryId,
          typeId: input.typeId,
          court: input.court,
          jurisdiction: input.jurisdiction,
          priority: input.priority,
          confidentiality: input.confidentiality,
          investigatingOfficerId: officerId,
          organizationId: user.organizationId,
          description: input.description,
          createdBy: user.id,
          tags: { create: input.tags.map((tag) => ({ tag })) },
        },
      });
      await tx.caseAssignment.create({
        data: { caseId: c.id, userId: officerId, roleOnCase: "INVESTIGATING_OFFICER", assignedBy: user.id },
      });
      // The creator keeps access to the case they opened even when they name
      // someone else as investigating officer.
      if (officerId !== user.id) {
        await tx.caseAssignment.create({ data: { caseId: c.id, userId: user.id, roleOnCase: "SUPERVISING_OFFICER", assignedBy: user.id } });
      }
      await AuditService.record(
        {
          actorId: user.id,
          actorRole: user.roles[0],
          action: "CASE_CREATED",
          resource: `case:${c.id}`,
          caseId: c.id,
          result: "SUCCESS",
          requestId,
          metadata: { caseNumber: c.caseNumber, manualCaseNumber: !!input.caseNumber },
        },
        tx,
      );
      return c;
    });
    return created;
  },

  async getById(user: AuthenticatedUser, caseId: string, requestId: string) {
    const c = await prisma.case.findFirst({
      where: { id: caseId, deletedAt: null },
      include: {
        category: true,
        type: true,
        investigatingOfficer: { select: { id: true, fullName: true, email: true } },
        organization: true,
        assignments: { include: { user: { select: { id: true, fullName: true, email: true } } } },
        tags: true,
        _count: { select: { documents: true, evidence: true } },
      },
    });
    if (!c) throw ApiError.notFound("Case");

    const allowed = await hasCaseAccess(user, c);
    if (!allowed) {
      await AuditService.record({
        actorId: user.id,
        actorRole: user.roles[0],
        action: "CASE_VIEWED",
        resource: `case:${caseId}`,
        caseId,
        result: "DENIED",
        requestId,
      });
      throw ApiError.forbidden("CASE_ACCESS_DENIED", "You do not have access to this case.");
    }

    await AuditService.record({ actorId: user.id, actorRole: user.roles[0], action: "CASE_VIEWED", resource: `case:${caseId}`, caseId, result: "SUCCESS", requestId });

    return c;
  },

  async update(user: AuthenticatedUser, caseId: string, input: z.infer<typeof UpdateCaseSchema>, requestId: string) {
    const c = await prisma.case.findFirst({ where: { id: caseId, deletedAt: null } });
    if (!c) throw ApiError.notFound("Case");
    const authz = await can(user, PERMISSIONS.CASE_UPDATE, { case: c });
    if (!authz.allowed) {
      await AuditService.record({
        actorId: user.id,
        actorRole: user.roles[0],
        action: "CASE_UPDATED",
        resource: `case:${caseId}`,
        caseId,
        result: "DENIED",
        reason: authz.reason,
        requestId,
      });
      throw ApiError.forbidden("CASE_ACCESS_DENIED", authz.reason);
    }

    if (input.typeId) await assertTypeInCategory(input.categoryId ?? c.categoryId, input.typeId);
    const officerChanged = !!input.investigatingOfficerId && input.investigatingOfficerId !== c.investigatingOfficerId;
    if (officerChanged) await assertAssignableOfficer(user, input.investigatingOfficerId!);

    const current = c as unknown as Record<string, unknown>;
    const changedFields = Object.entries(input)
      .filter(([k, v]) => v !== undefined && v !== current[k])
      .map(([k]) => k);

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.case.update({ where: { id: caseId }, data: { ...input, lastActivityAt: new Date() } });
      if (officerChanged) {
        await tx.caseAssignment.upsert({
          where: { caseId_userId: { caseId, userId: input.investigatingOfficerId! } },
          create: { caseId, userId: input.investigatingOfficerId!, roleOnCase: "INVESTIGATING_OFFICER", assignedBy: user.id },
          update: { roleOnCase: "INVESTIGATING_OFFICER" },
        });
      }
      await AuditService.record(
        {
          actorId: user.id,
          actorRole: user.roles[0],
          action: "CASE_UPDATED",
          resource: `case:${caseId}`,
          caseId,
          result: "SUCCESS",
          requestId,
          // Field names only; values (e.g. descriptions) can contain personal data.
          metadata: { changedFields },
        },
        tx,
      );
      return u;
    });
    return updated;
  },

  async assign(user: AuthenticatedUser, caseId: string, input: z.infer<typeof AssignCaseSchema>, requestId: string) {
    const c = await prisma.case.findFirst({ where: { id: caseId, deletedAt: null } });
    if (!c) throw ApiError.notFound("Case");
    const allowed = await hasCaseAccess(user, c);
    if (!allowed) throw ApiError.forbidden("CASE_ACCESS_DENIED");

    const assignment = await prisma.$transaction(async (tx) => {
      const a = await tx.caseAssignment.upsert({
        where: { caseId_userId: { caseId, userId: input.userId } },
        create: { caseId, userId: input.userId, roleOnCase: input.roleOnCase, assignedBy: user.id },
        update: { roleOnCase: input.roleOnCase, assignedBy: user.id, assignedAt: new Date() },
      });
      await tx.case.update({ where: { id: caseId }, data: { lastActivityAt: new Date() } });
      await AuditService.record(
        { actorId: user.id, actorRole: user.roles[0], action: "CASE_ASSIGNED", resource: `case:${caseId}`, caseId, result: "SUCCESS", requestId },
        tx,
      );
      return a;
    });
    return assignment;
  },

  async activity(user: AuthenticatedUser, caseId: string) {
    const c = await prisma.case.findFirst({ where: { id: caseId, deletedAt: null } });
    if (!c) throw ApiError.notFound("Case");
    const allowed = await hasCaseAccess(user, c);
    if (!allowed) throw ApiError.forbidden("CASE_ACCESS_DENIED");

    return prisma.auditEvent.findMany({
      where: { caseId },
      orderBy: { occurredAt: "desc" },
      take: 100,
      include: { actor: { select: { fullName: true } } },
    });
  },
};
