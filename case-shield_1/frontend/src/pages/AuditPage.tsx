import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
import { useAuth } from "@/hooks/useAuth";
import { AuditTrailView } from "@/features/audit/AuditTrailView";
import { ShieldAlert } from "lucide-react";

export function AuditPage() {
  const { hasPermission } = useAuth();

  const { data: securityEvents } = useQuery({
    queryKey: ["security-events"],
    queryFn: async () => (await api.get("/security/events")).data.events as any[],
    enabled: hasPermission("audit.view"),
    retry: false,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Audit Trail</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Append-only application audit log, limited to the cases you are authorized to review. Application-level monitoring — not a replacement for an enterprise SIEM.
        </p>
      </div>

      {(securityEvents?.length ?? 0) > 0 && (
        <div className="card p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
            <ShieldAlert className="h-4 w-4 text-warning" aria-hidden="true" /> Security events
          </h2>
          <ul className="space-y-2">
            {securityEvents!.slice(0, 8).map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <span className="font-medium text-ink">{e.type.replace(/_/g, " ")}</span>
                  <span className="ml-2 text-ink-muted">{e.detail}</span>
                </div>
                <StatusBadge status={e.severity} />
              </li>
            ))}
          </ul>
        </div>
      )}

      <AuditTrailView />
    </div>
  );
}
