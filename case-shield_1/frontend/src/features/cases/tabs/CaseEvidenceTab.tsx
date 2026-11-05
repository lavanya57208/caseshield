import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { api, normalizeApiError } from "@/lib/api";
import { DataTable, Column } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { useToast } from "@/components/Toast";
import { useAuth } from "@/hooks/useAuth";
import { EvidenceItem, EvidenceStatus, IncomingTransfer } from "@/types";
import { EVIDENCE_STATUS_LABELS, EVIDENCE_TYPES, EVIDENCE_TYPE_LABELS } from "@/lib/evidence";
import { formatDate, formatRelative } from "@/lib/format";
import { RegisterEvidenceDialog } from "@/features/evidence/RegisterEvidenceDialog";
import { TransferEvidenceDialog } from "@/features/evidence/TransferEvidenceDialog";
import { ArrowRightLeft, Eye, GitCommitVertical, Inbox, Plus, ScrollText, Search, Shield, ShieldCheck } from "lucide-react";

function IconAction({ label, onClick, to, icon: Icon }: { label: string; onClick?: () => void; to?: string; icon: typeof Eye }) {
  const cls = "inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-subtle hover:bg-navy-50 hover:text-ink";
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  return to ? (
    <Link to={to} className={cls} title={label} aria-label={label} onClick={stop}>
      <Icon className="h-4 w-4" />
    </Link>
  ) : (
    <button type="button" className={cls} title={label} aria-label={label} onClick={(e) => { stop(e); onClick?.(); }}>
      <Icon className="h-4 w-4" />
    </button>
  );
}

export function CaseEvidenceTab({ caseId }: { caseId: string }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { notify } = useToast();
  const { hasPermission } = useAuth();
  const [registerOpen, setRegisterOpen] = useState(false);
  const [transferFor, setTransferFor] = useState<EvidenceItem | null>(null);
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [q, setQ] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["evidence", caseId, status, type, q],
    queryFn: async () =>
      (await api.get("/evidence", { params: { caseId, status: status || undefined, type: type || undefined, q: q || undefined } })).data as {
        items: EvidenceItem[];
        total: number;
        courtOnly: boolean;
      },
    retry: false,
  });

  const { data: incoming } = useQuery({
    queryKey: ["incoming-transfers"],
    queryFn: async () => (await api.get("/evidence/transfers/incoming")).data.transfers as IncomingTransfer[],
  });
  const incomingHere = (incoming ?? []).filter((t) => t.evidence.caseId === caseId);

  const detailUrl = (e: EvidenceItem, section?: string) => `/cases/${caseId}/evidence/${e.id}${section ? `#${section}` : ""}`;

  async function verify(e: EvidenceItem) {
    try {
      const { data: result } = await api.post(`/evidence/${e.id}/verify-integrity`);
      notify(`${e.evidenceNumber}: ${result.label}`, result.status === "VERIFIED" ? "success" : "danger");
      qc.invalidateQueries({ queryKey: ["evidence", caseId] });
    } catch (err) {
      notify(normalizeApiError(err).message, "danger");
    }
  }

  const columns: Column<EvidenceItem>[] = [
    {
      header: "Evidence",
      accessor: (e) => (
        <div className="flex items-start gap-2.5">
          <Shield className="mt-0.5 h-4 w-4 flex-shrink-0 text-ink-subtle" aria-hidden="true" />
          <div>
            <p className="font-mono text-xs font-semibold text-ink">{e.evidenceNumber}</p>
            <p className="font-medium text-ink">{e.title}</p>
          </div>
        </div>
      ),
    },
    { header: "Type", accessor: (e) => <span className="text-ink-muted">{EVIDENCE_TYPE_LABELS[e.type] ?? e.type}</span> },
    { header: "Status", accessor: (e) => <StatusBadge status={e.status} /> },
    {
      header: "Current Custodian",
      accessor: (e) => (
        <div>
          <p className="text-ink">{e.currentCustodian?.fullName ?? "—"}</p>
          {e.pendingTransfer && <p className="text-xs text-warning">→ {e.pendingTransfer.toCustodian.fullName} (pending)</p>}
        </div>
      ),
    },
    { header: "Registered", accessor: (e) => <span className="text-ink-subtle">{formatDate(e.createdAt)}</span> },
    {
      header: "Integrity",
      accessor: (e) =>
        e.integrityStatus ? (
          <StatusBadge status={e.integrityStatus} />
        ) : (
          <span className="text-xs text-ink-subtle">No digital file</span>
        ),
    },
    { header: "Last Activity", accessor: (e) => <span className="text-ink-subtle">{formatRelative(e.lastActivityAt)}</span> },
    {
      header: "Actions",
      accessor: (e) => (
        <div className="flex items-center gap-0.5">
          <IconAction label="View" to={detailUrl(e)} icon={Eye} />
          {e.allowedActions.includes("VERIFY_INTEGRITY") && <IconAction label="Verify integrity" onClick={() => verify(e)} icon={ShieldCheck} />}
          {e.allowedActions.includes("TRANSFER") && <IconAction label="Transfer" onClick={() => setTransferFor(e)} icon={ArrowRightLeft} />}
          <IconAction label="View chain of custody" to={detailUrl(e, "custody")} icon={GitCommitVertical} />
          {e.allowedActions.includes("VIEW_AUDIT") && <IconAction label="View audit" to={detailUrl(e, "audit")} icon={ScrollText} />}
        </div>
      ),
    },
  ];

  if (error) {
    return <p className="text-sm text-ink-muted">{normalizeApiError(error).message}</p>;
  }

  return (
    <div className="space-y-4">
      {incomingHere.length > 0 && (
        <div className="card border-l-4 border-l-warning p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Inbox className="h-4 w-4 text-warning" aria-hidden="true" /> Evidence awaiting your receipt
          </p>
          <ul className="mt-2 space-y-1.5">
            {incomingHere.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="text-ink-muted">
                  <span className="font-mono font-medium text-ink">{t.evidence.evidenceNumber}</span> · {t.evidence.title} · from {t.fromCustodian.fullName} · {t.reason}
                </span>
                <Link to={`/cases/${caseId}/evidence/${t.evidence.id}`} className="btn-secondary px-3 py-1 text-xs">Review</Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-ink-subtle" aria-hidden="true" />
            <input className="input w-56 pl-8" placeholder="Search evidence ID or title" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search evidence" />
          </div>
          <select className="input w-44" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
            <option value="">All statuses</option>
            {(Object.keys(EVIDENCE_STATUS_LABELS) as EvidenceStatus[]).map((s) => <option key={s} value={s}>{EVIDENCE_STATUS_LABELS[s]}</option>)}
          </select>
          <select className="input w-44" value={type} onChange={(e) => setType(e.target.value)} aria-label="Filter by type">
            <option value="">All types</option>
            {EVIDENCE_TYPES.map((t) => <option key={t} value={t}>{EVIDENCE_TYPE_LABELS[t]}</option>)}
          </select>
        </div>
        {hasPermission("evidence.register") && (
          <button className="btn-primary" onClick={() => setRegisterOpen(true)}>
            <Plus className="h-4 w-4" /> Register evidence
          </button>
        )}
      </div>

      <p className="text-sm text-ink-muted">
        {data?.total ?? 0} evidence item{data?.total === 1 ? "" : "s"}
        {data?.courtOnly && " · showing evidence submitted to court only"}
      </p>

      <DataTable
        columns={columns}
        rows={data?.items ?? []}
        loading={isLoading}
        onRowClick={(e) => navigate(detailUrl(e))}
        emptyTitle="No evidence registered yet"
        emptyDescription="Register physical, digital and forensic evidence tied to this case to start its chain of custody."
      />

      <RegisterEvidenceDialog
        open={registerOpen}
        caseId={caseId}
        onClose={() => setRegisterOpen(false)}
        onRegistered={(e) => {
          setRegisterOpen(false);
          qc.invalidateQueries({ queryKey: ["evidence", caseId] });
          navigate(detailUrl(e));
        }}
      />
      {transferFor && (
        <TransferEvidenceDialog
          evidence={transferFor}
          onClose={() => setTransferFor(null)}
          onDone={() => {
            setTransferFor(null);
            qc.invalidateQueries({ queryKey: ["evidence", caseId] });
          }}
        />
      )}
    </div>
  );
}
