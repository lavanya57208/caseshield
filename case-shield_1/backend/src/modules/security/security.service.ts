import { prisma } from "@/lib/prisma";

export interface RecordSecurityEventInput {
  type:
    | "FAILED_LOGIN"
    | "SUSPICIOUS_ACCESS"
    | "INTEGRITY_VIOLATION"
    | "UNUSUAL_DOWNLOAD"
    | "PERMISSION_CHANGE"
    | "EXPIRED_ACCESS"
    | "POLICY_VIOLATION";
  userId?: string | null;
  caseId?: string | null;
  documentId?: string | null;
  severity?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  detail: string;
}

// Application-level security monitoring — explicitly NOT a replacement for
// an enterprise SIEM. See docs/security-architecture.md §12.
export const SecurityService = {
  async record(input: RecordSecurityEventInput) {
    return prisma.securityEvent.create({
      data: {
        type: input.type,
        userId: input.userId ?? null,
        caseId: input.caseId ?? null,
        documentId: input.documentId ?? null,
        severity: input.severity ?? "MEDIUM",
        detail: input.detail,
      },
    });
  },

  async list(limit = 100) {
    return prisma.securityEvent.findMany({
      orderBy: { occurredAt: "desc" },
      take: limit,
      include: {
        user: { select: { fullName: true, email: true } },
        case: { select: { caseNumber: true, title: true } },
      },
    });
  },
};
