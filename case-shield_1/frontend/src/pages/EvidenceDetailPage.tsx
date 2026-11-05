import { useEffect, useState, ReactNode } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, normalizeApiError } from "@/lib/api";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { StatusBadge } from "@/components/StatusBadge";
import { SkeletonRows } from "@/components/Skeleton";
import { ErrorState } from "@/components/ErrorState";
import { EmptyState } from "@/components/EmptyState";
import { useToast } from "@/components/Toast";
import { CustodyChainVerificationResult, CustodyTimelineResponse, EvidenceItem } from "@/types";
import { DIRECT_ACTIONS, DirectUiAction, EVIDENCE_TYPE_LABELS } from "@/lib/evidence";
import { formatDateTime, formatFileSize, truncateHash } from "@/lib/format";
import { CustodyTimeline } from "@/features/evidence/CustodyTimeline";
import { TransferEvidenceDialog } from "@/features/evidence/TransferEvidenceDialog";
import { EvidenceActionDialog, EvidenceDialogAction } from "@/features/evidence/EvidenceActionDialog";
import { EvidenceVerificationPanel } from "@/features/evidence/EvidenceVerificationPanel";
import { AuditTrailView } from "@/features/audit/AuditTrailView";
import { ArrowRightLeft, Clock, FileText, Lock, PackageCheck, ShieldOff, UserRound } from "lucide-react";

function Field({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-ink-subtle">{label}</dt>
      <dd className={mono ? "break-all font-mono text-xs text-ink" : "text-sm text-ink"}>{children ?? "—"}</dd>
    </div>
  );
}

function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-ink">{children}</h2>
      {aside}
    </div>
  );
}

export function EvidenceDetailPage() {
  const { caseId, evidenceId } = useParams<{ caseId: string; evidenceId: string }>();
  const qc = useQueryClient();
  const { notify } = useToast();
  const [transferOpen, setTransferOpen] = useState(false);
  const [dialogAction, setDialogAction] = useState<EvidenceDialogAction | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [chainResult, setChainResult] = useState<CustodyChainVerificationResult | null>(null);
  const location = useLocation();

  const detail = useQuery({
    queryKey: ["evidence-detail", evidenceId],
    queryFn: async () => (await api.get(`/evidence/${evidenceId}`)).data.evidence as EvidenceItem,
    enabled: !!evidenceId,
    refetchOnWindowFocus: false, // every load is an audited access
    retry: false,
  });

  const custody = useQuery({
    queryKey: ["custody", evidenceId],
    queryFn: async () => (await api.get(`/evidence/${evidenceId}/custody`)).data as CustodyTimelineResponse,
    enabled: !!detail.data,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!location.hash || !detail.data || custody.isLoading) return;
    document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: "start" });
  }, [location.hash, detail.data, custody.isLoading]);

  if (detail.isLoading) return <SkeletonRows rows={8} />;
  if (detail.error || !detail.data) {
    const status = normalizeApiError(detail.error).status;
    return <ErrorState message={status === 403 ? "You are not authorized to view this evidence." : "This evidence record could not be loaded."} />;
  }

  const e = detail.data;
  const can = (a: EvidenceItem["allowedActions"][number]) => e.allowedActions.includes(a);
  const directActions = (Object.keys(DIRECT_ACTIONS) as DirectUiAction[]).filter((a) => can(a));

  function applyUpdate(updated: EvidenceItem) {
    qc.setQueryData(["evidence-detail", evidenceId], updated);
    qc.invalidateQueries({ queryKey: ["custody", evidenceId] });
    qc.invalidateQueries({ queryKey: ["evidence", e.caseId] });
    qc.invalidateQueries({ queryKey: ["audit"] });
    setTransferOpen(false);
    setDialogAction(null);
    setChainResult(null);
  }

  async function acceptTransfer() {
    setAccepting(true);
    try {
      const { data } = await api.post(`/evidence/${e.id}/transfers/${e.pendingTransfer!.id}/accept`, {});
      notify(`Custody of ${e.evidenceNumber} accepted.`, "success");
      applyUpdate(data.evidence);
      qc.invalidateQueries({ queryKey: ["incoming-transfers"] });
    } catch (err) {
      notify(normalizeApiError(err).message, "danger");
    } finally {
      setAccepting(false);
    }
  }

  const flagged = chainResult?.failures.map((f) => f.sequence).filter((s): s is number => s != null);

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "Cases", to: "/cases" },
          { label: e.case.caseNumber, to: `/cases/${caseId ?? e.caseId}?tab=evidence` },
          { label: e.evidenceNumber },
        ]}
      />

      {/* Header */}
      <div className="card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-mono text-xl font-semibold text-ink">{e.evidenceNumber}</h1>
              <StatusBadge status={e.status} />
              {e.integrityStatus && <StatusBadge status={e.integrityStatus} label={e.integrityStatus === "VERIFIED" ? "Integrity verified" : e.integrityStatus === "VIOLATION" ? "Integrity violation" : "Unverified"} />}
            </div>
            <p className="mt-1 text-base text-ink-muted">{e.title}</p>
            <p className="text-xs text-ink-subtle">{EVIDENCE_TYPE_LABELS[e.type] ?? e.type}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {can("TRANSFER") && (
              <button className="btn-primary" onClick={() => setTransferOpen(true)}>
                <ArrowRightLeft className="h-4 w-4" /> Transfer
              </button>
            )}
            {directActions.map((a) => {
              const Icon = DIRECT_ACTIONS[a].icon;
              return (
                <button key={a} className="btn-secondary" onClick={() => setDialogAction(a)}>
                  <Icon className="h-4 w-4" /> {DIRECT_ACTIONS[a].label}
                </button>
              );
            })}
          </div>
        </div>

        {e.pendingTransfer && (
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-md border border-warning/30 bg-warning-bg p-4">
            <div className="flex items-start gap-2.5">
              <Clock className="mt-0.5 h-4 w-4 flex-shrink-0 text-warning" aria-hidden="true" />
              <div className="text-sm">
                <p className="font-semibold text-ink">Pending receipt</p>
                <p className="text-ink-muted">
                  {e.pendingTransfer.fromCustodian.fullName} → {e.pendingTransfer.toCustodian.fullName} · Reason: {e.pendingTransfer.reason}
                </p>
                <p className="text-xs text-ink-subtle">Initiated {formatDateTime(e.pendingTransfer.initiatedAt)} · custody changes only once the recipient accepts.</p>
              </div>
            </div>
            <div className="flex gap-2">
              {can("ACCEPT_TRANSFER") && (
                <button className="btn-primary" onClick={acceptTransfer} disabled={accepting}>
                  <PackageCheck className="h-4 w-4" /> {accepting ? "Accepting…" : "Accept evidence"}
                </button>
              )}
              {can("REJECT_TRANSFER") && <button className="btn-secondary" onClick={() => setDialogAction("REJECT_TRANSFER")}>Reject</button>}
              {can("CANCEL_TRANSFER") && <button className="btn-secondary" onClick={() => setDialogAction("CANCEL_TRANSFER")}>Cancel transfer</button>}
            </div>
          </div>
        )}

        <dl className="mt-5 grid grid-cols-1 gap-4 border-t border-border pt-5 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Evidence ID"><span className="font-mono">{e.evidenceNumber}</span></Field>
          <Field label="Case">
            <Link className="text-teal hover:underline" to={`/cases/${e.caseId}`}>{e.case.caseNumber}</Link>
          </Field>
          <Field label="Type">{EVIDENCE_TYPE_LABELS[e.type] ?? e.type}</Field>
          <Field label="Status"><StatusBadge status={e.status} /></Field>
          <Field label="Source">{e.source}</Field>
          <Field label="Collected at">{formatDateTime(e.collectedAt)}</Field>
          <Field label="Collected by">{e.collectedBy.fullName}</Field>
          <Field label="Registered by">{e.registeredBy.fullName}</Field>
          <Field label="Current custodian">
            <span className="inline-flex items-center gap-1.5 font-medium">
              <UserRound className="h-3.5 w-3.5 text-ink-subtle" aria-hidden="true" />
              {e.currentCustodian?.fullName ?? "—"}
            </span>
          </Field>
          <Field label="Confidentiality">
            <span className="inline-flex items-center gap-1"><Lock className="h-3.5 w-3.5 text-ink-subtle" aria-hidden="true" />{e.confidentiality.replace(/_/g, " ")}</span>
          </Field>
          <Field label="Location">{e.location}</Field>
          <Field label="Last activity">{formatDateTime(e.lastActivityAt)}</Field>
          <div className="sm:col-span-2 lg:col-span-4">
            <Field label="Description">{e.description}</Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="SHA-256 (registered)" mono>{e.originalHash ?? "No digital file attached"}</Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Integrity status">
              {e.integrityStatus ? <StatusBadge status={e.integrityStatus} /> : <span className="text-ink-subtle">Not applicable (no digital file)</span>}
            </Field>
          </div>
        </dl>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* Chain of custody */}
        <div id="custody" className="card scroll-mt-4 p-5 lg:col-span-2">
          <SectionTitle aside={<span className="text-xs text-ink-subtle">Tamper-evident, hash-linked history</span>}>Chain of custody</SectionTitle>
          {custody.isLoading ? (
            <SkeletonRows rows={4} />
          ) : custody.data && custody.data.events.length > 0 ? (
            <CustodyTimeline events={custody.data.events} highlightSequence={flagged} />
          ) : (
            <p className="text-sm text-ink-subtle">No custody events recorded.</p>
          )}
        </div>

        <div className="space-y-5">
          <EvidenceVerificationPanel evidence={e} onChainResult={setChainResult} />

          {/* Related documents */}
          <div className="card p-5">
            <SectionTitle>Related documents</SectionTitle>
            {e.originalDocument ? (
              <div className="flex items-start gap-2.5">
                <FileText className="mt-0.5 h-4 w-4 flex-shrink-0 text-ink-subtle" aria-hidden="true" />
                <div className="min-w-0 text-sm">
                  {e.originalDocument.canView ? (
                    <Link to={`/documents/${e.originalDocument.id}`} className="font-medium text-teal hover:underline">
                      {e.originalDocument.title}
                    </Link>
                  ) : (
                    <p className="font-medium text-ink">Restricted document</p>
                  )}
                  <p className="text-xs text-ink-subtle">
                    {e.originalDocument.documentNumber} · version {e.originalDocument.versionNumber} · {formatFileSize(e.originalDocument.fileSize)}
                  </p>
                  <p className="mt-1 font-mono text-[11px] text-ink-subtle" title={e.originalDocument.registeredVersionHash}>
                    {truncateHash(e.originalDocument.registeredVersionHash, 12)}
                  </p>
                  <p className="mt-1 text-xs text-ink-subtle">Referenced original — never modified or copied by evidence workflows.</p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-ink-subtle">No document is attached to this evidence item.</p>
            )}
          </div>
        </div>
      </div>

      {/* Audit trail */}
      <div id="audit" className="card scroll-mt-4 p-5">
        <SectionTitle>Audit trail</SectionTitle>
        {can("VIEW_AUDIT") ? (
          <AuditTrailView fixedCaseId={e.caseId} fixedEvidenceId={e.id} pageSize={15} />
        ) : (
          <EmptyState icon={ShieldOff} title="Audit access restricted" description="Your role does not include audit.view for this case. The chain of custody above remains visible to you." />
        )}
      </div>

      {transferOpen && <TransferEvidenceDialog evidence={e} onClose={() => setTransferOpen(false)} onDone={applyUpdate} />}
      {dialogAction && <EvidenceActionDialog evidence={e} action={dialogAction} onClose={() => setDialogAction(null)} onDone={applyUpdate} />}
    </div>
  );
}
