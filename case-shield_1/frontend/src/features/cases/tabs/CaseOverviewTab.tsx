import { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowRight, FileText, History, Shield, Tag, UploadCloud, Users } from "lucide-react";
import { api } from "@/lib/api";
import { CaseDetail, DocumentSummary } from "@/types";
import { Timeline, TimelineEntry } from "@/components/Timeline";
import { StatusBadge, PriorityBadge } from "@/components/StatusBadge";
import { Skeleton } from "@/components/Skeleton";
import { formatDate, formatDateTime } from "@/lib/format";
import { documentTypeLabel, fileIcon } from "@/lib/documents";

const ACTION_TONE: Record<string, TimelineEntry["tone"]> = {
  CASE_CREATED: "neutral",
  CASE_UPDATED: "neutral",
  DOCUMENT_UPLOADED: "success",
  DOCUMENT_VERSION_CREATED: "success",
  EVIDENCE_REGISTERED: "success",
  INTEGRITY_VERIFIED: "success",
  ACCESS_GRANTED: "success",
  INTEGRITY_VIOLATION: "danger",
  ACCESS_REVOKED: "warning",
};

const ACTION_LABELS: Record<string, string> = {
  CASE_CREATED: "Case created",
  CASE_UPDATED: "Case details updated",
  CASE_VIEWED: "Case opened",
  DOCUMENT_UPLOADED: "Document uploaded",
  DOCUMENT_VERSION_CREATED: "New document version",
  DOCUMENT_VIEWED: "Document viewed",
  DOCUMENT_DOWNLOADED: "Document downloaded",
  INTEGRITY_VERIFIED: "Integrity verified",
  INTEGRITY_VIOLATION: "Integrity violation detected",
  EVIDENCE_REGISTERED: "Evidence registered",
};
const actionLabel = (a: string) => ACTION_LABELS[a] ?? a.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

// Routine reads and background pipeline steps would drown out the case's story.
const NOISY_ACTIONS = new Set(["CASE_VIEWED", "DOCUMENT_VIEWED", "DOCUMENT_INTELLIGENCE_VIEWED", "EVIDENCE_VIEWED", "DOCUMENT_SEARCH_PERFORMED"]);
const isNoisy = (action: string) =>
  NOISY_ACTIONS.has(action) || action.startsWith("AI_PROCESSING") || action.startsWith("OCR_") || ["DOCUMENT_CLASSIFIED", "DOCUMENT_METADATA_EXTRACTED", "DOCUMENT_SUMMARY_GENERATED"].includes(action);

export function CaseOverviewTab({ caseData, onOpenDocuments, onUpload }: { caseData: CaseDetail; onOpenDocuments: () => void; onUpload?: () => void }) {
  const activity = useQuery({
    queryKey: ["case-activity", caseData.id],
    queryFn: async () => (await api.get(`/cases/${caseData.id}/activity`)).data.events as any[],
  });
  const documents = useQuery({
    queryKey: ["documents", caseData.id],
    queryFn: async () => (await api.get("/documents", { params: { caseId: caseData.id, pageSize: 100 } })).data as { items: DocumentSummary[]; total: number },
  });

  const timelineEntries: TimelineEntry[] =
    activity.data
      ?.filter((e) => !isNoisy(e.action))
      .slice(0, 7)
      .map((e) => ({
        id: e.id,
        title: actionLabel(e.action),
        detail: e.actor?.fullName ? `by ${e.actor.fullName}` : "System event",
        timestamp: e.occurredAt,
        tone: ACTION_TONE[e.action] ?? "neutral",
      })) ?? [];

  const docs = documents.data?.items ?? [];
  const verified = docs.filter((d) => d.versions[0]?.integrityStatus === "VERIFIED").length;

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
      <div className="space-y-6 xl:col-span-2">
        <Card title="Case information">
          <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            <Info label="Case number" value={<span className="font-mono">{caseData.caseNumber}</span>} />
            <Info label="Category" value={caseData.category.name} />
            <Info label="Case type" value={caseData.type.name} />
            <Info label="Court / forum" value={caseData.court} />
            <Info label="Status" value={<StatusBadge status={caseData.status} />} />
            <Info label="Priority" value={<PriorityBadge priority={caseData.priority} />} />
            <Info label="Assigned investigator" value={caseData.investigatingOfficer?.fullName ?? "Unassigned"} />
            <Info label="Created" value={formatDate(caseData.createdAt ?? caseData.openedAt)} />
            <Info label="Last updated" value={formatDateTime(caseData.updatedAt ?? caseData.lastActivityAt)} />
          </dl>
        </Card>

        <Card title="Description">
          <p className="whitespace-pre-line text-sm leading-relaxed text-ink-muted">{caseData.description}</p>
          {caseData.tags.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {caseData.tags.map((t) => (
                <span key={t.tag} className="inline-flex items-center gap-1 rounded-full bg-navy-50 px-2.5 py-1 text-xs text-navy-600">
                  <Tag className="h-3 w-3" aria-hidden="true" />
                  {t.tag}
                </span>
              ))}
            </div>
          )}
        </Card>

        <Card
          title="Documents"
          icon={FileText}
          action={
            docs.length > 0 && (
              <button onClick={onOpenDocuments} className="flex items-center gap-1 text-xs font-medium text-teal hover:underline">
                View all {documents.data?.total} <ArrowRight className="h-3 w-3" />
              </button>
            )
          }
        >
          {documents.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
            </div>
          ) : docs.length === 0 ? (
            <div className="flex flex-col items-center rounded-lg border border-dashed border-border py-8 text-center">
              <FileText className="mb-2 h-6 w-6 text-navy-300" aria-hidden="true" />
              <p className="text-sm font-medium text-ink">No documents yet</p>
              <p className="mt-0.5 text-sm text-ink-muted">Upload the first document to start building this case record.</p>
              {onUpload && (
                <button className="btn-primary btn-sm mt-3" onClick={onUpload}>
                  <UploadCloud className="h-3.5 w-3.5" /> Upload document
                </button>
              )}
            </div>
          ) : (
            <>
              <p className="mb-3 text-xs text-ink-subtle">
                {documents.data?.total} document{documents.data?.total === 1 ? "" : "s"} · {verified} with verified integrity
              </p>
              <ul className="divide-y divide-border">
                {docs.slice(0, 4).map((d) => {
                  const v = d.versions[0];
                  const Icon = fileIcon(v?.mimeType);
                  return (
                    <li key={d.id}>
                      <Link to={`/documents/${d.id}`} className="-mx-2 flex items-center gap-3 rounded-md px-2 py-2.5 hover:bg-navy-50/60">
                        <Icon className="h-4 w-4 flex-shrink-0 text-ink-subtle" aria-hidden="true" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-ink">{d.title}</p>
                          <p className="text-xs text-ink-subtle">
                            {documentTypeLabel(d.type)} · v{v?.versionNumber ?? 1} · {formatDate(d.createdAt)}
                          </p>
                        </div>
                        <StatusBadge status={v?.integrityStatus ?? "UNVERIFIED"} />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </Card>
      </div>

      <div className="space-y-6">
        <Card title="Recent activity" icon={History}>
          {activity.isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-9" />
              ))}
            </div>
          ) : timelineEntries.length === 0 ? (
            <p className="text-sm text-ink-subtle">No recorded activity yet.</p>
          ) : (
            <Timeline entries={timelineEntries} />
          )}
        </Card>

        <Card title="At a glance">
          <div className="grid grid-cols-2 gap-3">
            <Stat icon={FileText} value={caseData._count?.documents ?? 0} label="Documents" />
            <Stat icon={Shield} value={caseData._count?.evidence ?? 0} label="Evidence items" />
          </div>
        </Card>

        <Card title="Case team" icon={Users}>
          {caseData.assignments.length === 0 ? (
            <p className="text-sm text-ink-subtle">No team members assigned yet.</p>
          ) : (
            <ul className="space-y-3">
              {caseData.assignments.map((a) => (
                <li key={a.user.id} className="flex items-center gap-3">
                  <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-navy-50 text-xs font-semibold text-navy-600">
                    {a.user.fullName
                      .split(" ")
                      .map((p) => p[0])
                      .slice(0, 2)
                      .join("")}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">{a.user.fullName}</p>
                    <p className="text-xs text-ink-subtle">{a.roleOnCase.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function Card({ title, icon: Icon, action, children }: { title: string; icon?: typeof FileText; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="card p-5">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="section-title flex items-center gap-2">
          {Icon && <Icon className="h-4 w-4 text-ink-subtle" aria-hidden="true" />}
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Info({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="eyebrow">{label}</dt>
      <dd className="mt-1 text-sm text-ink">{value}</dd>
    </div>
  );
}

function Stat({ icon: Icon, value, label }: { icon: typeof FileText; value: number; label: string }) {
  return (
    <div className="rounded-lg bg-surface p-3 text-center">
      <Icon className="mx-auto mb-1 h-4 w-4 text-navy-400" aria-hidden="true" />
      <p className="text-xl font-semibold text-ink">{value}</p>
      <p className="text-xs text-ink-subtle">{label}</p>
    </div>
  );
}
