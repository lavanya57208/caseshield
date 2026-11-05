import { prisma } from "@/lib/prisma";
import { AuthenticatedUser } from "@/middleware/auth";
import { hasCaseAccess, can } from "@/lib/authorization";
import { PERMISSIONS } from "@/lib/permissions";
import { EvidenceService } from "@/modules/evidence/evidence.service";

const OVERSIGHT_ROLES = new Set(["ADMIN", "AUDITOR"]);

// Authorization-aware search — see docs/architecture.md §8 and
// docs/security-architecture.md. A result is filtered out BEFORE ranking,
// never redacted after: this function never returns a hit for a case the
// caller cannot see, so unauthorized users cannot even infer a matching
// case/document/evidence record exists.
export const SearchService = {
  async search(user: AuthenticatedUser, q: string, type?: "case" | "document" | "evidence") {
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

    const results: any[] = [];

    if (!type || type === "case") {
      const cases = await prisma.case.findMany({
        where: {
          organizationId: user.organizationId,
          deletedAt: null,
          title: { contains: q, mode: "insensitive" },
          ...caseVisibility,
        },
        take: 20,
        include: { category: true },
      });
      results.push(...cases.map((c) => ({ kind: "case", id: c.id, title: c.title, subtitle: c.caseNumber, status: c.status })));
    }

    if (!type || type === "document") {
      const visibleCases = await prisma.case.findMany({
        where: { organizationId: user.organizationId, deletedAt: null, ...caseVisibility },
        select: { id: true },
      });
      const caseIds = visibleCases.map((c) => c.id);
      const docs = await prisma.document.findMany({
        where: { caseId: { in: caseIds }, deletedAt: null, title: { contains: q, mode: "insensitive" } },
        take: 20,
        include: { case: { select: { caseNumber: true } } },
      });
      // Document-level authorization is re-checked per-hit for the highest
      // confidentiality tiers, since document.view can be narrower than
      // case.view for RESTRICTED/HIGHLY_CONFIDENTIAL material.
      for (const d of docs) {
        if (d.confidentiality === "RESTRICTED" || d.confidentiality === "HIGHLY_CONFIDENTIAL") {
          const authz = await can(user, PERMISSIONS.DOCUMENT_VIEW, { case: { id: d.caseId, organizationId: user.organizationId, investigatingOfficerId: null, confidentiality: "INTERNAL" }, document: d });
          if (!authz.allowed) continue;
        }
        results.push({ kind: "document", id: d.id, title: d.title, subtitle: `${d.documentNumber} · ${d.case.caseNumber}`, type: d.type });
      }
    }

    if (!type || type === "evidence") {
      const visibleCases = await prisma.case.findMany({
        where: { organizationId: user.organizationId, deletedAt: null, ...caseVisibility },
        select: { id: true },
      });
      const caseIds = visibleCases.map((c) => c.id);
      const evidence = await prisma.evidence.findMany({
        where: {
          caseId: { in: caseIds },
          deletedAt: null,
          OR: [
            { title: { contains: q, mode: "insensitive" } },
            { evidenceNumber: { contains: q, mode: "insensitive" } },
            { description: { contains: q, mode: "insensitive" } },
          ],
        },
        take: 20,
        include: { case: true },
      });
      // Evidence-level policy (evidence.view, confidentiality, court-only
      // visibility) — case visibility alone is not enough.
      for (const e of evidence) {
        if (!(await EvidenceService.isVisibleTo(user, e))) continue;
        results.push({ kind: "evidence", id: e.id, caseId: e.caseId, title: e.title, subtitle: `${e.evidenceNumber} · ${e.case.caseNumber}`, status: e.status });
      }
    }

    return results;
  },
};
