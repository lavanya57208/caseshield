import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { FolderKanban, FolderPlus, Search } from "lucide-react";
import { api } from "@/lib/api";
import { DataTable, Column } from "@/components/DataTable";
import { StatusBadge, PriorityBadge } from "@/components/StatusBadge";
import { PageHeader } from "@/components/PageHeader";
import { useAuth } from "@/hooks/useAuth";
import { CaseSummary } from "@/types";
import { formatRelative, formatDate } from "@/lib/format";
import { CaseFormDialog } from "@/features/cases/CaseFormDialog";

const STATUS_OPTIONS = [
  { value: "ACTIVE", label: "Active" },
  { value: "UNDER_REVIEW", label: "Under review" },
  { value: "ON_HOLD", label: "On hold" },
  { value: "CLOSED", label: "Closed" },
  { value: "ARCHIVED", label: "Archived" },
];
const PRIORITY_OPTIONS = [
  { value: "CRITICAL", label: "Critical" },
  { value: "HIGH", label: "High" },
  { value: "MEDIUM", label: "Medium" },
  { value: "LOW", label: "Low" },
];

export function CasesListPage() {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [q, setQ] = useState("");
  const [newCaseOpen, setNewCaseOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["cases", { status, priority, q }],
    queryFn: async () => {
      const { data } = await api.get("/cases", { params: { status: status || undefined, priority: priority || undefined, q: q || undefined, pageSize: 50 } });
      return data as { items: CaseSummary[]; total: number };
    },
    placeholderData: (prev) => prev,
  });

  const columns: Column<CaseSummary>[] = [
    { header: "Case ID", accessor: (c) => <span className="whitespace-nowrap font-mono text-xs font-medium text-teal-dark">{c.caseNumber}</span> },
    {
      header: "Case title",
      accessor: (c) => (
        <div className="min-w-[180px]">
          <p className="font-medium text-ink">{c.title}</p>
          <p className="text-xs text-ink-subtle">{c.court}</p>
        </div>
      ),
    },
    {
      header: "Category",
      accessor: (c) => (
        <div>
          <p className="text-ink-muted">{c.category.name}</p>
          <p className="text-xs text-ink-subtle">{c.type.name}</p>
        </div>
      ),
    },
    { header: "Status", accessor: (c) => <StatusBadge status={c.status} /> },
    { header: "Priority", accessor: (c) => <PriorityBadge priority={c.priority} /> },
    { header: "Investigator", accessor: (c) => <span className="text-ink-muted">{c.investigatingOfficer?.fullName ?? "—"}</span> },
    {
      header: "Updated",
      accessor: (c) => (
        <span className="whitespace-nowrap text-ink-subtle" title={formatDate(c.lastActivityAt)}>
          {formatRelative(c.lastActivityAt)}
        </span>
      ),
    },
  ];

  const filtered = !!(status || priority || q);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Cases"
        subtitle={`${data?.total ?? 0} case${data?.total === 1 ? "" : "s"} visible to your account`}
        actions={
          hasPermission("case.create") && (
            <button className="btn-primary" onClick={() => setNewCaseOpen(true)}>
              <FolderPlus className="h-4 w-4" /> Create new case
            </button>
          )
        }
      />

      <div className="card flex flex-wrap items-center gap-3 p-3">
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" aria-hidden="true" />
          <input className="input pl-9" placeholder="Search by case title…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search cases by title" />
        </div>
        <select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <select className="input w-auto" value={priority} onChange={(e) => setPriority(e.target.value)} aria-label="Filter by priority">
          <option value="">All priorities</option>
          {PRIORITY_OPTIONS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
        {filtered && (
          <button
            className="btn-ghost btn-sm"
            onClick={() => {
              setQ("");
              setStatus("");
              setPriority("");
            }}
          >
            Clear filters
          </button>
        )}
      </div>

      <DataTable
        columns={columns}
        rows={data?.items ?? []}
        loading={isLoading}
        onRowClick={(c) => navigate(`/cases/${c.id}`)}
        emptyIcon={FolderKanban}
        emptyTitle={filtered ? "No cases match your filters" : "No cases yet"}
        emptyDescription={filtered ? "Try adjusting your search or filters." : "Create the first case to start managing documents and evidence."}
      />

      <CaseFormDialog
        mode="create"
        open={newCaseOpen}
        onClose={() => setNewCaseOpen(false)}
        onSaved={(c) => {
          setNewCaseOpen(false);
          navigate(`/cases/${c.id}`);
        }}
      />
    </div>
  );
}
