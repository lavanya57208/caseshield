import { createPortal } from "react-dom";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, normalizeApiError } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/components/Toast";
import { StatusBadge } from "@/components/StatusBadge";
import { downloadFile, SHARE_PURPOSE_OPTIONS } from "@/lib/files";
import { formatDateTime, formatFileSize, truncateHash } from "@/lib/format";
import { AuditEvent, DocumentDerivative, DocumentShare, PiiScan, SharePurpose } from "@/types";
import { PiiReviewDialog } from "@/features/security/PiiReviewDialog";
import { SecureShareDialog } from "@/features/security/SecureShareDialog";
import { ScanSearch, EyeOff, Stamp, Share2, Download, Layers, Users, ScrollText, X } from "lucide-react";

type DocSummary = { id: string; title: string; documentNumber: string; confidentiality: string; caseId: string };

/**
 * Phase 2 document security workflow, embedded in the existing document
 * detail page: PII scan → review → redacted copy → watermark → secure share,
 * plus derived copies, shares and this document's audit trail. Buttons are
 * shown per role for UX only; the backend enforces every permission.
 */
export function DocumentSecurityPanel({ document: doc }: { document: DocSummary }) {
  const { hasPermission } = useAuth();
  const { notify } = useToast();
  const qc = useQueryClient();
  const [scanning, setScanning] = useState(false);
  const [reviewScan, setReviewScan] = useState<PiiScan | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [watermarkOpen, setWatermarkOpen] = useState(false);

  const canScan = hasPermission("document.scan");
  const canRedact = hasPermission("document.redact");
  const canShare = hasPermission("document.share");
  const canDownload = hasPermission("document.download");
  const canAudit = hasPermission("audit.view");

  const scans = useQuery({
    queryKey: ["pii-scans", doc.id],
    queryFn: async () => (await api.get(`/documents/${doc.id}/pii-scans`)).data.scans as PiiScan[],
    enabled: canScan,
  });
  const derivatives = useQuery({
    queryKey: ["derivatives", doc.id],
    queryFn: async () => (await api.get(`/documents/${doc.id}/derivatives`)).data.derivatives as DocumentDerivative[],
  });
  const shares = useQuery({
    queryKey: ["document-shares", doc.id],
    queryFn: async () => (await api.get("/shares", { params: { scope: "document", documentId: doc.id } })).data.shares as DocumentShare[],
  });
  const audit = useQuery({
    queryKey: ["document-audit", doc.id],
    queryFn: async () => (await api.get("/audit", { params: { documentId: doc.id, pageSize: 25 } })).data.items as AuditEvent[],
    enabled: canAudit,
  });

  function refresh() {
    for (const key of ["pii-scans", "derivatives", "document-shares", "document-audit", "document"]) qc.invalidateQueries({ queryKey: [key, doc.id] });
  }

  async function runScan() {
    setScanning(true);
    try {
      const { data } = await api.post(`/documents/${doc.id}/pii-scans`, {});
      setReviewScan(data.scan);
      refresh();
    } catch (err) {
      notify(normalizeApiError(err).message, "danger");
    } finally {
      setScanning(false);
    }
  }

  async function openLatestReview() {
    const latest = scans.data?.[0];
    if (!latest) return;
    try {
      const { data } = await api.get(`/documents/${doc.id}/pii-scans/${latest.id}`);
      setReviewScan(data.scan);
    } catch (err) {
      notify(normalizeApiError(err).message, "danger");
    }
  }

  async function revoke(id: string) {
    try {
      await api.post(`/shares/${id}/revoke`, {});
      notify("Share revoked. The recipient can no longer access it.", "success");
      refresh();
    } catch (err) {
      notify(normalizeApiError(err).message, "danger");
    }
  }

  const completedRedactions = (derivatives.data ?? []).filter((d) => d.type === "REDACTED" && d.status === "COMPLETED");

  return (
    <div className="card p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">Document security</h2>
          <p className="text-xs text-ink-subtle">PII protection, derived copies and controlled sharing. The original evidence file is never modified.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canScan && (
            <button className="btn-secondary" onClick={runScan} disabled={scanning}>
              <ScanSearch className="h-4 w-4" /> {scanning ? "Scanning…" : "Scan for PII"}
            </button>
          )}
          {canScan && (scans.data?.length ?? 0) > 0 && (
            <button className="btn-secondary" onClick={openLatestReview}>
              <EyeOff className="h-4 w-4" /> {canRedact ? "Review PII / Create redacted copy" : "Review PII"}
            </button>
          )}
          {canDownload && (
            <button className="btn-secondary" onClick={() => setWatermarkOpen(true)}>
              <Stamp className="h-4 w-4" /> Watermarked copy
            </button>
          )}
          {canShare && (
            <button className="btn-primary" onClick={() => setShareOpen(true)}>
              <Share2 className="h-4 w-4" /> Share securely
            </button>
          )}
        </div>
      </div>

      {canScan && scans.data && scans.data.length > 0 && (
        <p className="mb-4 text-xs text-ink-muted">
          Last PII scan: {formatDateTime(scans.data[0].completedAt ?? scans.data[0].startedAt)} · <StatusBadge status={scans.data[0].status} /> ·{" "}
          {scans.data[0].findingCount} finding(s)
        </p>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <section>
          <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink-subtle">
            <Layers className="h-3.5 w-3.5" /> Derived copies
          </h3>
          {(derivatives.data ?? []).length === 0 ? (
            <p className="text-sm text-ink-subtle">No redacted or watermarked copies yet.</p>
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border">
              {derivatives.data!.slice(0, 8).map((d) => (
                <li key={d.id} className="flex items-start justify-between gap-3 p-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium text-ink">
                      {d.type === "REDACTED" ? "Redacted" : "Watermarked"} copy{d.shareId ? " (delivered via share)" : ""}
                    </p>
                    <p className="text-xs text-ink-subtle">
                      from v{d.sourceVersionNumber} · {formatDateTime(d.createdAt)} · {d.createdBy?.fullName}
                      {d.fileSize ? ` · ${formatFileSize(d.fileSize)}` : ""}
                    </p>
                    {d.watermarkMetadata?.recipient && (
                      <p className="text-xs text-ink-subtle">For {d.watermarkMetadata.recipient} · {d.watermarkMetadata.purposeLabel} · ref {d.watermarkMetadata.copyReference}</p>
                    )}
                    {d.sha256Hash && <p className="font-mono text-[11px] text-ink-subtle">{truncateHash(d.sha256Hash, 10)}</p>}
                    {d.statusReason && <p className="text-xs text-warning">{d.statusReason}</p>}
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-2">
                    <StatusBadge status={d.status} />
                    {canDownload && d.status === "COMPLETED" && (
                      <button
                        className="btn-ghost px-2 py-1"
                        aria-label="Download derived copy"
                        onClick={() => downloadFile(`/documents/${doc.id}/derivatives/${d.id}/download`, d.fileName ?? "copy").catch((e) => notify(e.message, "danger"))}
                      >
                        <Download className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink-subtle">
            <Users className="h-3.5 w-3.5" /> Secure shares
          </h3>
          {(shares.data ?? []).length === 0 ? (
            <p className="text-sm text-ink-subtle">This document has not been shared.</p>
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border">
              {shares.data!.map((s) => (
                <li key={s.id} className="flex items-start justify-between gap-3 p-3 text-sm">
                  <div>
                    <p className="font-medium text-ink">
                      {s.recipientOrganization ? `${s.recipientOrganization} · ` : ""}
                      {s.recipient.fullName}
                    </p>
                    <p className="text-xs text-ink-subtle">
                      {s.purposeLabel} · until {formatDateTime(s.expiresAt)} · {s.allowDownload ? "download" : "view only"}
                      {s.applyRedaction ? " · redacted" : ""}
                      {s.applyWatermark ? " · watermarked" : ""}
                    </p>
                    <p className="text-xs text-ink-subtle">Requested by {s.requestedBy.fullName}</p>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-2">
                    <StatusBadge status={s.status} />
                    {(s.status === "PENDING" || s.status === "APPROVED") && (canShare || hasPermission("access.approve")) && (
                      <button className="btn-ghost px-2 py-1 text-xs text-danger" onClick={() => revoke(s.id)}>Revoke</button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {canAudit && (
        <section className="mt-5">
          <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink-subtle">
            <ScrollText className="h-3.5 w-3.5" /> Document audit trail
          </h3>
          <div className="max-h-72 overflow-y-auto rounded-md border border-border">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-surface text-left uppercase tracking-wide text-ink-subtle">
                <tr>
                  <th className="px-3 py-2">Action</th>
                  <th className="px-3 py-2">Actor</th>
                  <th className="px-3 py-2">Result</th>
                  <th className="px-3 py-2">Context</th>
                  <th className="px-3 py-2">Time</th>
                </tr>
              </thead>
              <tbody>
                {(audit.data ?? []).map((e) => (
                  <tr key={e.id} className="border-t border-border">
                    <td className="px-3 py-1.5 font-medium text-ink">{e.action.replace(/_/g, " ")}</td>
                    <td className="px-3 py-1.5 text-ink-muted">{e.actor?.fullName ?? "System"}</td>
                    <td className="px-3 py-1.5"><StatusBadge status={e.result} /></td>
                    <td className="px-3 py-1.5 text-ink-subtle">
                      {[e.metadata?.purpose, e.metadata?.via && `via ${e.metadata.via}`, e.metadata?.code, e.reason].filter(Boolean).join(" · ") || "—"}
                    </td>
                    <td className="px-3 py-1.5 text-ink-subtle">{formatDateTime(e.occurredAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <PiiReviewDialog
        open={!!reviewScan}
        documentId={doc.id}
        documentTitle={doc.title}
        scan={reviewScan}
        canRedact={canRedact}
        onClose={() => setReviewScan(null)}
        onRedacted={refresh}
      />
      <SecureShareDialog open={shareOpen} document={doc} onClose={() => setShareOpen(false)} onCreated={refresh} />
      <WatermarkDialog open={watermarkOpen} documentId={doc.id} redactions={completedRedactions} onClose={() => setWatermarkOpen(false)} onCreated={refresh} />
    </div>
  );
}

function WatermarkDialog({
  open,
  documentId,
  redactions,
  onClose,
  onCreated,
}: {
  open: boolean;
  documentId: string;
  redactions: DocumentDerivative[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const { notify } = useToast();
  const [recipient, setRecipient] = useState("");
  const [purpose, setPurpose] = useState<SharePurpose>("COURT_FILING");
  const [purposeNote, setPurposeNote] = useState("");
  const [base, setBase] = useState("");
  const [working, setWorking] = useState(false);
  if (!open) return null;

  async function submit() {
    setWorking(true);
    try {
      const { data } = await api.post(`/documents/${documentId}/watermarks`, {
        recipient,
        purpose,
        purposeNote: purpose === "OTHER" ? purposeNote : undefined,
        redactedDerivativeId: base || undefined,
      });
      if (data.derivative.status === "COMPLETED") {
        notify("Watermarked copy created. The original is unchanged.", "success");
        onCreated();
        onClose();
      } else {
        notify(data.derivative.statusReason ?? "Watermarking is not supported for this file.", "danger");
      }
    } catch (err) {
      notify(normalizeApiError(err).message, "danger");
    } finally {
      setWorking(false);
    }
  }

  // Portal so layout spacing on the page never offsets the overlay.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-900/40 p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="wm-title" className="w-full max-w-md rounded-lg bg-white shadow-panel">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 id="wm-title" className="flex items-center gap-2 text-base font-semibold text-ink">
            <Stamp className="h-4 w-4" /> Create watermarked copy
          </h2>
          <button onClick={onClose} aria-label="Close dialog" className="text-ink-subtle hover:text-ink"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-4 px-6 py-5">
          <div>
            <label className="label" htmlFor="wm-recipient">Recipient</label>
            <input id="wm-recipient" className="input" placeholder="e.g. Prosecutor Office" value={recipient} onChange={(e) => setRecipient(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="wm-purpose">Purpose</label>
            <select id="wm-purpose" className="input" value={purpose} onChange={(e) => setPurpose(e.target.value as SharePurpose)}>
              {SHARE_PURPOSE_OPTIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
          {purpose === "OTHER" && (
            <input className="input" aria-label="Describe the purpose" placeholder="Describe the purpose" value={purposeNote} onChange={(e) => setPurposeNote(e.target.value)} />
          )}
          <div>
            <label className="label" htmlFor="wm-base">Source</label>
            <select id="wm-base" className="input" value={base} onChange={(e) => setBase(e.target.value)}>
              <option value="">Current version (unredacted)</option>
              {redactions.map((r) => (
                <option key={r.id} value={r.id}>Redacted copy · {formatDateTime(r.createdAt)}</option>
              ))}
            </select>
          </div>
          <p className="text-xs text-ink-subtle">The case ID, document ID, recipient, purpose and timestamp are stamped on every page of a new copy.</p>
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-6 py-4">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={working || recipient.trim().length < 2} onClick={submit}>{working ? "Creating…" : "Create copy"}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
