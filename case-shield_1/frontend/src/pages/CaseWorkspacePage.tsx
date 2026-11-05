import { useState } from "react";
import { Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { Building2, CalendarClock, FolderOpen, Lock, PencilLine, Scale, UploadCloud, UserRound } from "lucide-react";
import { api } from "@/lib/api";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { StatusBadge, PriorityBadge } from "@/components/StatusBadge";
import { Skeleton } from "@/components/Skeleton";
import { ErrorState } from "@/components/ErrorState";
import { useAuth } from "@/hooks/useAuth";
import { CaseDetail } from "@/types";
import { formatDate, formatRelative } from "@/lib/format";

import { CaseOverviewTab } from "@/features/cases/tabs/CaseOverviewTab";
import { CaseDocumentsTab } from "@/features/cases/tabs/CaseDocumentsTab";
import { CaseEvidenceTab } from "@/features/cases/tabs/CaseEvidenceTab";
import { CaseAuditTab } from "@/features/cases/tabs/CaseAuditTab";
import { CaseAccessTab } from "@/features/cases/tabs/CaseAccessTab";
import { CaseActivityTab } from "@/features/cases/tabs/CaseActivityTab";
import { CaseFormDialog } from "@/features/cases/CaseFormDialog";
import { UploadDocumentDialog } from "@/features/documents/UploadDocumentDialog";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "documents", label: "Documents" },
  { key: "evidence", label: "Evidence" },
  { key: "audit", label: "Audit Trail" },
  { key: "access", label: "Access Requests" },
  { key: "activity", label: "Activity" },
] as const;
type TabKey = (typeof TABS)[number]["key"];
const TAB_KEYS = TABS.map((t) => t.key) as readonly string[];

export function CaseWorkspacePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const tab: TabKey = requestedTab && TAB_KEYS.includes(requestedTab) ? (requestedTab as TabKey) : "overview";
  const [editOpen, setEditOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["case", id],
    queryFn: async () => (await api.get(`/cases/${id}`)).data.case as CaseDetail,
    enabled: !!id,
  });

  // The tab lives in the URL so "back to case" returns to the same tab.
  const setTab = (key: TabKey) => setSearchParams(key === "overview" ? {} : { tab: key }, { replace: true });

  // Pre-Phase 3 deep links (?tab=custody&evidence=<id>) now open the
  // evidence detail page, which hosts the chain of custody.
  const legacyEvidence = requestedTab === "custody" ? searchParams.get("evidence") : null;
  if (id && legacyEvidence) return <Navigate to={`/cases/${id}/evidence/${legacyEvidence}#custody`} replace />;
  if (id && requestedTab === "custody") return <Navigate to={`/cases/${id}?tab=evidence`} replace />;

  if (isLoading) return <WorkspaceSkeleton />;
  if (error || !data || !id) {
    return <ErrorState message="This case could not be loaded. You may not have access, or it may not exist." />;
  }

  const counts: Partial<Record<TabKey, number>> = { documents: data._count?.documents, evidence: data._count?.evidence };
  const canEdit = hasPermission("case.update");
  const canUpload = hasPermission("document.upload");

  return (
    <div className="space-y-5">
      <Breadcrumbs items={[{ label: "Cases", to: "/cases" }, { label: data.caseNumber }]} />

      <section className="card overflow-hidden">
        <div className="h-1 bg-gradient-to-r from-navy-700 via-slateblue to-teal" aria-hidden="true" />
        <div className="p-6">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div className="flex min-w-0 items-start gap-4">
              <div className="hidden h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-navy-700 text-white sm:flex">
                <Scale className="h-6 w-6" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <p className="font-mono text-sm font-medium tracking-wide text-teal-dark">{data.caseNumber}</p>
                <h1 className="mt-0.5 text-2xl font-semibold tracking-tight text-ink">{data.title}</h1>
                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-navy-100 bg-navy-50 px-2 py-0.5 text-xs font-medium text-navy-600">
                    <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" /> {data.category.name}
                  </span>
                  <PriorityBadge priority={data.priority} />
                  <StatusBadge status={data.status} />
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-0.5 text-xs font-medium text-ink-muted">
                    <Lock className="h-3.5 w-3.5" aria-hidden="true" /> {data.confidentiality.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {canEdit && (
                <button className="btn-secondary" onClick={() => setEditOpen(true)}>
                  <PencilLine className="h-4 w-4" /> Edit case
                </button>
              )}
              {canUpload && (
                <button className="btn-primary" onClick={() => setUploadOpen(true)}>
                  <UploadCloud className="h-4 w-4" /> Upload document
                </button>
              )}
            </div>
          </div>

          <dl className="mt-6 grid grid-cols-1 gap-4 border-t border-border pt-5 sm:grid-cols-2 lg:grid-cols-4">
            <HeaderFact icon={Building2} label="Court / Forum" value={data.court} />
            <HeaderFact icon={Scale} label="Case type" value={data.type.name} />
            <HeaderFact icon={UserRound} label="Investigating officer" value={data.investigatingOfficer?.fullName ?? "Unassigned"} />
            <HeaderFact icon={CalendarClock} label="Opened · last activity" value={`${formatDate(data.openedAt)} · ${formatRelative(data.lastActivityAt)}`} />
          </dl>
        </div>
      </section>

      <div role="tablist" aria-label="Case workspace sections" className="flex gap-1 overflow-x-auto border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={clsx(
              "-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
              tab === t.key ? "border-teal text-teal-dark" : "border-transparent text-ink-muted hover:border-border-strong hover:text-ink",
            )}
          >
            {t.label}
            {counts[t.key] !== undefined && (
              <span className={clsx("rounded-full px-1.5 py-px text-[11px] font-semibold", tab === t.key ? "bg-teal/10 text-teal-dark" : "bg-navy-50 text-ink-subtle")}>{counts[t.key]}</span>
            )}
          </button>
        ))}
      </div>

      <div role="tabpanel" className="animate-fade-in" key={tab}>
        {tab === "overview" && <CaseOverviewTab caseData={data} onOpenDocuments={() => setTab("documents")} onUpload={canUpload ? () => setUploadOpen(true) : undefined} />}
        {tab === "documents" && <CaseDocumentsTab caseId={id} caseNumber={data.caseNumber} onUpload={canUpload ? () => setUploadOpen(true) : undefined} />}
        {tab === "evidence" && <CaseEvidenceTab caseId={id} />}
        {tab === "audit" && <CaseAuditTab caseId={id} />}
        {tab === "access" && <CaseAccessTab caseId={id} />}
        {tab === "activity" && <CaseActivityTab caseId={id} />}
      </div>

      {canEdit && <CaseFormDialog mode="edit" open={editOpen} existing={data} onClose={() => setEditOpen(false)} onSaved={() => setEditOpen(false)} />}
      <UploadDocumentDialog
        open={uploadOpen}
        caseId={id}
        caseNumber={data.caseNumber}
        onClose={() => setUploadOpen(false)}
        onUploaded={() => {
          if (tab !== "documents") setTab("documents");
        }}
      />
    </div>
  );
}

function HeaderFact({ icon: Icon, label, value }: { icon: typeof Building2; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="mt-0.5 h-4 w-4 flex-shrink-0 text-ink-subtle" aria-hidden="true" />
      <div className="min-w-0">
        <dt className="text-xs text-ink-subtle">{label}</dt>
        <dd className="truncate text-sm font-medium text-ink">{value}</dd>
      </div>
    </div>
  );
}


function WorkspaceSkeleton() {
  return (
    <div className="space-y-5" role="status" aria-label="Loading case">
      <Skeleton className="h-4 w-40" />
      <div className="card space-y-4 p-6">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-7 w-2/3" />
        <Skeleton className="h-5 w-72" />
        <div className="grid grid-cols-4 gap-4 border-t border-border pt-5">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-9" />
          ))}
        </div>
      </div>
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
