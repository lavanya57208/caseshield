import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, normalizeApiError } from "@/lib/api";
import { DataTable, Column } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/EmptyState";
import { AuditEvent, AuditFacets } from "@/types";
import { formatDateTime } from "@/lib/format";
import { Building2, RotateCcw, ShieldOff } from "lucide-react";

// Scoped, filterable audit trail. The backend decides what is visible:
// every filter is re-authorized server-side (GET /api/audit), and the
// dropdown options come from GET /api/audit/facets, limited to the same
// scope — so this UI never lists a case the user cannot audit.

interface Filters {
  caseId: string;
  evidenceId: string;
  actorId: string;
  action: string;
  result: string;
  from: string;
  to: string;
}

const EMPTY: Filters = { caseId: "", evidenceId: "", actorId: "", action: "", result: "", from: "", to: "" };

export function AuditTrailView({ fixedCaseId, fixedEvidenceId, pageSize = 25 }: { fixedCaseId?: string; fixedEvidenceId?: string; pageSize?: number }) {
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [page, setPage] = useState(1);
  const caseId = fixedCaseId ?? filters.caseId;
  const evidenceId = fixedEvidenceId ?? filters.evidenceId;

  const set = (patch: Partial<Filters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  };

  const facets = useQuery({
    queryKey: ["audit-facets", caseId || null],
    queryFn: async () => (await api.get("/audit/facets", { params: { caseId: caseId || undefined } })).data as AuditFacets,
    retry: false,
  });

  const params = useMemo(
    () => ({
      page,
      pageSize,
      caseId: caseId || undefined,
      evidenceId: evidenceId || undefined,
      actorId: filters.actorId || undefined,
      action: filters.action || undefined,
      result: filters.result || undefined,
      from: filters.from ? new Date(`${filters.from}T00:00:00`).toISOString() : undefined,
      to: filters.to ? new Date(`${filters.to}T23:59:59.999`).toISOString() : undefined,
    }),
    [page, pageSize, caseId, evidenceId, filters],
  );

  const events = useQuery({
    queryKey: ["audit", params],
    queryFn: async () => (await api.get("/audit", { params })).data as { items: AuditEvent[]; total: number; pageSize: number },
    retry: false,
  });

  const denied = facets.error ?? events.error;
  if (denied && normalizeApiError(denied).status === 403) {
    return (
      <EmptyState
        icon={ShieldOff}
        title="Audit access restricted"
        description="You are not authorized to view audit data in this scope. Audit trails are available to Senior Investigators, Judges, Auditors and Administrators for cases they may review, or via a case-level audit.view grant."
      />
    );
  }

  const evidenceOptions = (facets.data?.evidence ?? []).filter((e) => !caseId || e.caseId === caseId);
  const hasFilters = Object.entries(filters).some(([k, v]) => v && !(k === "caseId" && fixedCaseId));

  const columns: Column<AuditEvent>[] = [
    { header: "Timestamp", accessor: (e) => <span className="whitespace-nowrap text-ink-subtle">{formatDateTime(e.occurredAt)}</span> },
    { header: "Actor", accessor: (e) => <span className="text-ink">{e.actor?.fullName ?? "System"}</span> },
    { header: "Action", accessor: (e) => <span className="font-mono text-xs font-medium text-ink">{e.action}</span> },
    {
      header: "Subject",
      accessor: (e) => (
        <span className="font-mono text-xs text-ink-muted">
          {e.evidence?.evidenceNumber ?? e.document?.documentNumber ?? e.case?.caseNumber ?? e.resource}
          {!fixedCaseId && e.case && (e.evidence || e.document) && <span className="block text-ink-subtle">{e.case.caseNumber}</span>}
        </span>
      ),
    },
    { header: "Result", accessor: (e) => <StatusBadge status={e.result} /> },
    { header: "Reason", accessor: (e) => <span className="text-xs text-ink-muted">{e.reason ?? ""}</span> },
  ];

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
          {!fixedCaseId && (
            <div>
              <label className="label text-xs" htmlFor="af-case">Case</label>
              <select id="af-case" className="input" value={filters.caseId} onChange={(e) => set({ caseId: e.target.value, evidenceId: "" })}>
                <option value="">All cases</option>
                {facets.data?.cases.map((c) => <option key={c.id} value={c.id}>{c.caseNumber}</option>)}
              </select>
            </div>
          )}
          {!fixedEvidenceId && (
            <div>
              <label className="label text-xs" htmlFor="af-evidence">Evidence</label>
              <select id="af-evidence" className="input" value={filters.evidenceId} onChange={(e) => set({ evidenceId: e.target.value })}>
                <option value="">All evidence</option>
                {evidenceOptions.map((e) => <option key={e.id} value={e.id}>{e.evidenceNumber}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="label text-xs" htmlFor="af-actor">Actor</label>
            <select id="af-actor" className="input" value={filters.actorId} onChange={(e) => set({ actorId: e.target.value })}>
              <option value="">All actors</option>
              {facets.data?.actors.map((a) => <option key={a.id} value={a.id}>{a.fullName}</option>)}
            </select>
          </div>
          <div>
            <label className="label text-xs" htmlFor="af-action">Action</label>
            <select id="af-action" className="input" value={filters.action} onChange={(e) => set({ action: e.target.value })}>
              <option value="">All actions</option>
              {facets.data?.actions.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <label className="label text-xs" htmlFor="af-result">Result</label>
            <select id="af-result" className="input" value={filters.result} onChange={(e) => set({ result: e.target.value })}>
              <option value="">Any result</option>
              <option value="SUCCESS">Success</option>
              <option value="DENIED">Denied</option>
              <option value="ERROR">Error</option>
            </select>
          </div>
          <div>
            <label className="label text-xs" htmlFor="af-from">Date from</label>
            <input id="af-from" type="date" className="input" value={filters.from} max={filters.to || undefined} onChange={(e) => set({ from: e.target.value })} />
          </div>
          <div>
            <label className="label text-xs" htmlFor="af-to">Date to</label>
            <input id="af-to" type="date" className="input" value={filters.to} min={filters.from || undefined} onChange={(e) => set({ to: e.target.value })} />
          </div>
          <div className="flex items-end">
            <button type="button" className="btn-ghost w-full" onClick={() => set(EMPTY)} disabled={!hasFilters}>
              <RotateCcw className="h-4 w-4" /> Reset
            </button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-xs text-ink-subtle">
          <span className="inline-flex items-center gap-1.5">
            <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
            Organization: <span className="font-medium text-ink-muted">{facets.data?.organization?.name ?? "—"}</span>
            {facets.data && !facets.data.orgWide && <span>· limited to {facets.data.cases.length} case{facets.data.cases.length === 1 ? "" : "s"} you may audit</span>}
          </span>
          <span>{events.data?.total ?? 0} event{events.data?.total === 1 ? "" : "s"}</span>
        </div>
      </div>

      <DataTable columns={columns} rows={events.data?.items ?? []} loading={events.isLoading} emptyTitle="No audit events match these filters" />

      {events.data && events.data.total > events.data.pageSize && (
        <div className="flex items-center justify-between text-sm text-ink-muted">
          <button className="btn-secondary" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
          <span>Page {page} of {Math.ceil(events.data.total / events.data.pageSize)}</span>
          <button className="btn-secondary" disabled={page * events.data.pageSize >= events.data.total} onClick={() => setPage((p) => p + 1)}>Next</button>
        </div>
      )}
    </div>
  );
}
