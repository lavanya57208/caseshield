import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import { api, normalizeApiError } from "@/lib/api";
import { useToast } from "@/components/Toast";
import { StatusBadge } from "@/components/StatusBadge";
import { DocumentDerivative, PiiScan } from "@/types";
import { AlertTriangle, EyeOff, ShieldCheck, X } from "lucide-react";

const CONFIDENCE_TONE: Record<string, string> = {
  HIGH: "text-danger",
  MEDIUM: "text-warning",
  LOW: "text-ink-subtle",
};

/**
 * PII REVIEW — shows masked findings only (the API never returns raw
 * values). The reviewer decides which findings to redact; the redacted copy
 * is a separate derivative and the original is never modified.
 */
export function PiiReviewDialog({
  open,
  documentId,
  documentTitle,
  scan,
  canRedact,
  onClose,
  onRedacted,
}: {
  open: boolean;
  documentId: string;
  documentTitle: string;
  scan: PiiScan | null;
  canRedact: boolean;
  onClose: () => void;
  onRedacted: (derivative: DocumentDerivative) => void;
}) {
  const { notify } = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [working, setWorking] = useState(false);
  const [result, setResult] = useState<DocumentDerivative | null>(null);

  useEffect(() => {
    setSelected(new Set(scan?.findings.map((f) => f.id) ?? []));
    setResult(null);
  }, [scan?.id, open]);

  if (!open || !scan) return null;

  const allSelected = scan.findings.length > 0 && selected.size === scan.findings.length;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function redact() {
    setWorking(true);
    try {
      const { data } = await api.post(`/documents/${documentId}/redactions`, { scanId: scan!.id, findingIds: [...selected] });
      const derivative = data.derivative as DocumentDerivative;
      setResult(derivative);
      if (derivative.status === "COMPLETED") {
        notify("Redacted copy created. The original document is unchanged.", "success");
        onRedacted(derivative);
      } else {
        notify(derivative.statusReason ?? "Redaction could not be completed.", "danger");
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
      <div role="dialog" aria-modal="true" aria-labelledby="pii-review-title" className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-lg bg-white shadow-panel">
        <div className="flex items-start justify-between border-b border-border px-6 py-4">
          <div>
            <h2 id="pii-review-title" className="flex items-center gap-2 text-base font-semibold text-ink">
              <EyeOff className="h-4 w-4" aria-hidden="true" /> PII REVIEW
            </h2>
            <p className="mt-0.5 text-sm text-ink-muted">
              Document: <span className="font-medium text-ink">{documentTitle}</span>
              {scan.versionNumber ? ` · v${scan.versionNumber}` : ""}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close dialog" className="text-ink-subtle hover:text-ink">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <StatusBadge status={scan.status} />
            <span className="text-ink-muted">
              {scan.findingCount} finding{scan.findingCount === 1 ? "" : "s"} · provider {scan.provider}
            </span>
          </div>

          {scan.statusReason && (
            <p className="rounded-md border border-warning/20 bg-warning-bg p-3 text-sm text-ink-muted">{scan.statusReason}</p>
          )}

          {scan.limitations.length > 0 && (
            <div className="rounded-md border border-warning/20 bg-warning-bg p-3 text-xs text-ink-muted">
              <p className="mb-1 flex items-center gap-1.5 font-semibold text-warning">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> Detection limitations
              </p>
              <ul className="list-disc space-y-0.5 pl-5">
                {scan.limitations.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </div>
          )}

          {scan.findings.length > 0 ? (
            <div className="overflow-hidden rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="bg-surface text-left text-xs uppercase tracking-wide text-ink-subtle">
                  <tr>
                    <th className="w-10 px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label="Select all findings"
                        checked={allSelected}
                        onChange={() => setSelected(allSelected ? new Set() : new Set(scan.findings.map((f) => f.id)))}
                      />
                    </th>
                    <th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2">Confidence</th>
                    <th className="px-3 py-2">Page</th>
                    <th className="px-3 py-2">Masked preview</th>
                  </tr>
                </thead>
                <tbody>
                  {scan.findings.map((f) => (
                    <tr key={f.id} className="border-t border-border">
                      <td className="px-3 py-2">
                        <input type="checkbox" aria-label={`Redact ${f.label} ${f.maskedPreview}`} checked={selected.has(f.id)} onChange={() => toggle(f.id)} />
                      </td>
                      <td className="px-3 py-2">
                        <p className="font-medium text-ink">{f.label}</p>
                        <p className="text-[11px] text-ink-subtle">{f.detectionMethod}</p>
                      </td>
                      <td className={`px-3 py-2 text-xs font-semibold ${CONFIDENCE_TONE[f.confidence]}`}>{f.confidence}</td>
                      <td className="px-3 py-2 text-ink-muted">{f.pageNumber ?? "—"}</td>
                      <td className="px-3 py-2 font-mono text-xs text-ink">{f.maskedPreview}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            scan.status === "COMPLETED" && (
              <p className="text-sm text-ink-muted">
                No PII was detected by the automated rules. This does not guarantee the document contains no personal information.
              </p>
            )
          )}

          {result && (
            <div className={`rounded-md border p-3 text-sm ${result.status === "COMPLETED" ? "border-success/20 bg-success-bg" : "border-danger/20 bg-danger-bg"}`}>
              <p className="flex items-center gap-2 font-semibold">
                {result.status === "COMPLETED" ? <ShieldCheck className="h-4 w-4 text-success" /> : <AlertTriangle className="h-4 w-4 text-danger" />}
                {result.status === "COMPLETED" ? "REDACTED COPY CREATED" : `REDACTION ${result.status}`}
              </p>
              {result.status === "COMPLETED" ? (
                <>
                  <p className="mt-1 text-ink-muted">
                    {result.redactionMetadata?.redactedCount} item(s) removed · verification {result.redactionMetadata?.verification}. The original is unchanged.
                  </p>
                  <p className="mt-1 break-all font-mono text-[11px] text-ink-subtle">SHA-256: {result.sha256Hash}</p>
                  {result.redactionMetadata?.notes?.map((n) => (
                    <p key={n} className="mt-1 text-xs text-ink-subtle">{n}</p>
                  ))}
                </>
              ) : (
                <p className="mt-1 text-ink-muted">{result.statusReason}</p>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border px-6 py-4">
          <p className="text-xs text-ink-subtle">{selected.size} selected for redaction</p>
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={onClose}>
              {result?.status === "COMPLETED" ? "Done" : "Cancel"}
            </button>
            {canRedact && scan.status === "COMPLETED" && scan.findings.length > 0 && result?.status !== "COMPLETED" && (
              <button className="btn-primary" disabled={working || selected.size === 0} onClick={redact}>
                {working ? "Redacting…" : "Redact selected"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
