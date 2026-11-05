import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { Activity, ArrowRight, ChevronRight, ClipboardCheck, FileText, FolderKanban, FolderPlus, Search, ShieldAlert, ShieldCheck, UploadCloud } from "lucide-react";
import clsx from "clsx";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { StatusBadge, PriorityBadge } from "@/components/StatusBadge";
import { Skeleton } from "@/components/Skeleton";
import { ErrorState } from "@/components/ErrorState";
import { PageHeader } from "@/components/PageHeader";
import { formatDate, formatRelative } from "@/lib/format";
import { CaseFormDialog } from "@/features/cases/CaseFormDialog";
import { UploadDocumentDialog } from "@/features/documents/UploadDocumentDialog";

interface DashboardData {
  activeCases: number;
  documentCount: number;
  pendingActions: number;
  pendingTransfers: number;
  approvableAccessRequests: number;
  myPendingAccessRequests: number;
  recentCases: any[];
  recentAudit: any[];
  integrityViolations: number;
  unreadNotifications: number;
}

const ACTIVITY_LABELS: Record<string, string> = {
  CASE_CREATED: "created a case",
  CASE_UPDATED: "updated case details",
  DOCUMENT_UPLOADED: "uploaded a document",
  DOCUMENT_VERSION_CREATED: "added a document version",
  DOCUMENT_DOWNLOADED: "downloaded a document",
  INTEGRITY_VERIFIED: "verified document integrity",
  INTEGRITY_VIOLATION: "detected an integrity violation",
  EVIDENCE_REGISTERED: "registered evidence",
  CUSTODY_TRANSFERRED: "transferred custody",
  ACCESS_REQUESTED: "requested access",
  ACCESS_GRANTED: "granted access",
  AI_CLASSIFICATION_REVIEWED: "reviewed an AI classification",
  LOGIN: "signed in",
};
// Routine reads and background pipeline steps would drown out people's actions.
const NOISY = new Set(["CASE_VIEWED", "DOCUMENT_VIEWED", "EVIDENCE_VIEWED", "DOCUMENT_INTELLIGENCE_VIEWED", "DOCUMENT_SEARCH_PERFORMED", "LOGIN", "LOGOUT"]);
const isNoisy = (action: string) => NOISY.has(action) || action.startsWith("AI_PROCESSING") || action.startsWith("OCR_") || ["DOCUMENT_CLASSIFIED", "DOCUMENT_METADATA_EXTRACTED", "DOCUMENT_SUMMARY_GENERATED"].includes(action);

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export function DashboardPage() {
  const { user, hasPermission, hasRole } = useAuth();
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);

  const { data, isLoading, error } = useQuery<DashboardData>({
    queryKey: ["dashboard"],
    queryFn: async () => (await api.get("/dashboard")).data,
  });

  const roleName = user?.roles[0]?.name ?? "Viewer";
  const oversight = hasRole("AUDITOR", "JUDGE", "ADMIN");
  const canCreate = hasPermission("case.create");
  const canUpload = hasPermission("document.upload");

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${greeting()}, ${user?.fullName?.split(" ")[0] ?? ""}`}
        subtitle={`${roleName} · ${oversight ? "Organization-wide oversight view" : "Cases assigned to you"}`}
        actions={
          canCreate && (
            <button className="btn-primary" onClick={() => setCreateOpen(true)}>
              <FolderPlus className="h-4 w-4" /> Create new case
            </button>
          )
        }
      />

      {error ? (
        <ErrorState message="Could not load your dashboard. Please try again." />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard loading={isLoading} icon={FolderKanban} label="Active cases" value={data?.activeCases} to="/cases" />
            <StatCard loading={isLoading} icon={FileText} label="Documents" value={data?.documentCount} hint="Across your cases" />
            <StatCard
              loading={isLoading}
              icon={ClipboardCheck}
              label="Pending actions"
              value={data?.pendingActions}
              tone={(data?.pendingActions ?? 0) > 0 ? "warning" : "neutral"}
              hint={data ? pendingHint(data) : undefined}
              to="/notifications"
            />
            <StatCard
              loading={isLoading}
              icon={(data?.integrityViolations ?? 0) > 0 ? ShieldAlert : ShieldCheck}
              label={(data?.integrityViolations ?? 0) > 0 ? "Integrity alerts" : "Integrity status"}
              value={(data?.integrityViolations ?? 0) > 0 ? data?.integrityViolations : "Secure"}
              tone={(data?.integrityViolations ?? 0) > 0 ? "danger" : "success"}
              hint={(data?.integrityViolations ?? 0) > 0 ? "Versions failing verification" : "All document versions verified"}
            />
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
            <section className="card overflow-hidden">
              <div className="flex items-center justify-between border-b border-border px-5 py-4">
                <h2 className="section-title">Recent cases</h2>
                <Link to="/cases" className="flex items-center gap-1 text-xs font-medium text-teal hover:underline">
                  View all cases <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
              {isLoading ? (
                <div className="space-y-2 p-5">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-11" />
                  ))}
                </div>
              ) : (data?.recentCases.length ?? 0) === 0 ? (
                <div className="flex flex-col items-center px-6 py-12 text-center">
                  <FolderKanban className="mb-2 h-7 w-7 text-navy-300" aria-hidden="true" />
                  <p className="text-sm font-medium text-ink">No cases yet</p>
                  <p className="mt-0.5 text-sm text-ink-muted">Cases you create or are assigned to will appear here.</p>
                  {canCreate && (
                    <button className="btn-primary btn-sm mt-4" onClick={() => setCreateOpen(true)}>
                      <FolderPlus className="h-3.5 w-3.5" /> Create case
                    </button>
                  )}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-surface text-left">
                        <th scope="col" className="eyebrow whitespace-nowrap px-4 py-2.5">Case ID</th>
                        <th scope="col" className="eyebrow whitespace-nowrap px-4 py-2.5">Case title</th>
                        <th scope="col" className="eyebrow hidden whitespace-nowrap px-4 py-2.5 lg:table-cell">Category</th>
                        <th scope="col" className="eyebrow whitespace-nowrap px-4 py-2.5">Status</th>
                        <th scope="col" className="eyebrow whitespace-nowrap px-4 py-2.5">Updated</th>
                        <th scope="col" className="px-2 py-2.5">
                          <span className="sr-only">Action</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data!.recentCases.map((c) => (
                        <tr key={c.id} onClick={() => navigate(`/cases/${c.id}`)} className="group cursor-pointer border-b border-border last:border-0 hover:bg-navy-50/50">
                          <td className="whitespace-nowrap px-4 py-3 font-mono text-xs font-medium text-teal-dark">{c.caseNumber}</td>
                          {/* w-full + max-w-0 lets the title take the remaining width and truncate. */}
                          <td className="w-full max-w-0 px-4 py-3">
                            <p className="truncate font-medium text-ink" title={c.title}>
                              {c.title}
                            </p>
                            <p className="mt-0.5 flex items-center gap-2 text-xs text-ink-subtle">
                              <PriorityBadge priority={c.priority} /> {c._count?.documents ?? 0} {c._count?.documents === 1 ? "doc" : "docs"}
                            </p>
                          </td>
                          <td className="hidden px-4 py-3 lg:table-cell">
                            <p className="max-w-[160px] truncate text-ink-muted" title={c.category?.name}>
                              {c.category?.name}
                            </p>
                          </td>
                          <td className="whitespace-nowrap px-4 py-3">
                            <StatusBadge status={c.status} />
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-ink-subtle" title={formatDate(c.lastActivityAt)}>
                            {formatRelative(c.lastActivityAt)}
                          </td>
                          <td className="px-2 py-3 text-right">
                            <Link
                              to={`/cases/${c.id}`}
                              onClick={(e) => e.stopPropagation()}
                              aria-label={`Open ${c.caseNumber}`}
                              title="Open case"
                              className="inline-flex rounded-md p-1 text-ink-subtle group-hover:bg-teal/10 group-hover:text-teal"
                            >
                              <ChevronRight className="h-4 w-4" />
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <div className="space-y-6">
              <section className="card p-5">
                <h2 className="section-title mb-3">Quick actions</h2>
                <div className="space-y-2">
                  {canCreate && <QuickAction icon={FolderPlus} label="Create case" detail="Register a new case record" onClick={() => setCreateOpen(true)} primary />}
                  {canUpload && <QuickAction icon={UploadCloud} label="Upload document" detail="Add a file to an existing case" onClick={() => setUploadOpen(true)} />}
                  <QuickAction icon={Search} label="Search documents" detail="Full-text search across your cases" onClick={() => navigate("/search?tab=document")} />
                </div>
              </section>

              <section className="card p-5">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="section-title flex items-center gap-2">
                    <Activity className="h-4 w-4 text-ink-subtle" aria-hidden="true" /> Recent activity
                  </h2>
                  <Link to="/audit" className="text-xs font-medium text-teal hover:underline">
                    Audit trail
                  </Link>
                </div>
                <ActivityFeed loading={isLoading} events={data?.recentAudit ?? []} />
              </section>
            </div>
          </div>
        </>
      )}

      {canCreate && (
        <CaseFormDialog
          mode="create"
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onSaved={(c) => {
            setCreateOpen(false);
            navigate(`/cases/${c.id}`);
          }}
        />
      )}
      {canUpload && <UploadDocumentDialog open={uploadOpen} onClose={() => setUploadOpen(false)} />}
    </div>
  );
}

function pendingHint(d: DashboardData) {
  const parts: string[] = [];
  if (d.pendingTransfers) parts.push(`${d.pendingTransfers} evidence receipt${d.pendingTransfers === 1 ? "" : "s"}`);
  const requests = d.approvableAccessRequests || d.myPendingAccessRequests;
  if (requests) parts.push(`${requests} access request${requests === 1 ? "" : "s"}`);
  return parts.length ? parts.join(" · ") : "You're all caught up";
}

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  tone = "neutral",
  to,
  loading,
}: {
  icon: typeof FileText;
  label: string;
  value?: number | string;
  hint?: string;
  tone?: "neutral" | "warning" | "danger" | "success";
  to?: string;
  loading?: boolean;
}) {
  const toneClasses = { neutral: "bg-teal/10 text-teal", warning: "bg-warning-bg text-warning", danger: "bg-danger-bg text-danger", success: "bg-success-bg text-success" }[tone];
  const body = (
    <div className={clsx("card flex h-full items-start gap-4 p-5 transition-shadow", to && "hover:shadow-panel")}>
      <div className={clsx("flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg", toneClasses)}>
        <Icon className="h-5.5 w-5.5" aria-hidden="true" />
      </div>
      <div className="min-w-0">
        <p className="eyebrow">{label}</p>
        {loading ? <Skeleton className="mt-1.5 h-7 w-12" /> : <p className="mt-0.5 text-2xl font-semibold tracking-tight text-ink">{value ?? 0}</p>}
        {hint && !loading && <p className="mt-0.5 truncate text-xs text-ink-subtle">{hint}</p>}
      </div>
    </div>
  );
  return to ? (
    <Link to={to} className="block rounded-lg">
      {body}
    </Link>
  ) : (
    body
  );
}

function QuickAction({ icon: Icon, label, detail, onClick, primary }: { icon: typeof FileText; label: string; detail: string; onClick: () => void; primary?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "group flex w-full items-center gap-3 rounded-lg border px-3.5 py-3 text-left transition-colors",
        primary ? "border-navy-700 bg-navy-700 text-white hover:bg-navy-600" : "border-border bg-white hover:border-teal/40 hover:bg-teal/5",
      )}
    >
      <Icon className={clsx("h-5 w-5 flex-shrink-0", primary ? "text-teal-light" : "text-teal")} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className={clsx("text-sm font-medium", primary ? "text-white" : "text-ink")}>{label}</p>
        <p className={clsx("truncate text-xs", primary ? "text-navy-200" : "text-ink-subtle")}>{detail}</p>
      </div>
      <ChevronRight className={clsx("h-4 w-4 transition-transform group-hover:translate-x-0.5", primary ? "text-navy-200" : "text-ink-subtle")} aria-hidden="true" />
    </button>
  );
}

function ActivityFeed({ events, loading }: { events: any[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-9" />
        ))}
      </div>
    );
  }
  const shown = events.filter((e) => !isNoisy(e.action) && e.result !== "DENIED").slice(0, 6);
  if (shown.length === 0) return <p className="py-4 text-center text-sm text-ink-subtle">No recent activity yet.</p>;
  return (
    <ul className="space-y-3.5">
      {shown.map((e) => (
        <li key={e.id} className="flex items-start gap-3">
          <span className={clsx("mt-1.5 h-2 w-2 flex-shrink-0 rounded-full", e.action.includes("VIOLATION") ? "bg-danger" : e.action.startsWith("DOCUMENT") ? "bg-teal" : "bg-navy-300")} aria-hidden="true" />
          <div className="min-w-0 flex-1 text-sm">
            <p className="text-ink">
              <span className="font-medium">{e.actor?.fullName ?? "System"}</span>{" "}
              <span className="text-ink-muted">{ACTIVITY_LABELS[e.action] ?? e.action.replace(/_/g, " ").toLowerCase()}</span>
            </p>
            <p className="text-xs text-ink-subtle">
              {e.case?.caseNumber && <span className="font-mono">{e.case.caseNumber} · </span>}
              {formatRelative(e.occurredAt)}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
