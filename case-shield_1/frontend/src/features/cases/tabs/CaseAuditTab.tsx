import { AuditTrailView } from "@/features/audit/AuditTrailView";

export function CaseAuditTab({ caseId }: { caseId: string }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-muted">
        Append-only record of security-sensitive actions on this case — documents, evidence, custody transfers and access decisions.
      </p>
      <AuditTrailView fixedCaseId={caseId} />
    </div>
  );
}
