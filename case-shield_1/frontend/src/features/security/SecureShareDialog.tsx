import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, normalizeApiError } from "@/lib/api";
import { useToast } from "@/components/Toast";
import { StatusBadge } from "@/components/StatusBadge";
import { SHARE_PURPOSE_OPTIONS } from "@/lib/files";
import { formatDateTime } from "@/lib/format";
import { DocumentShare, PiiScan, ShareRecipient, SharePurpose } from "@/types";
import { Share2, X, CheckCircle2, AlertTriangle } from "lucide-react";

function isoDate(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * SECURE SHARE — creates a controlled, purpose-bound, time-limited share
 * request. Every option is re-validated server-side; the backend can only
 * make a share stricter (e.g. forcing a watermark on view-only shares or
 * approval for RESTRICTED documents), never looser.
 */
export function SecureShareDialog({
  open,
  document: doc,
  onClose,
  onCreated,
}: {
  open: boolean;
  document: { id: string; title: string; documentNumber: string; confidentiality: string };
  onClose: () => void;
  onCreated: () => void;
}) {
  const { notify } = useToast();
  const today = new Date();
  const [recipientId, setRecipientId] = useState("");
  const [recipientOrganization, setRecipientOrganization] = useState("");
  const [purpose, setPurpose] = useState<SharePurpose>("COURT_FILING");
  const [purposeNote, setPurposeNote] = useState("");
  const [expiry, setExpiry] = useState(isoDate(new Date(today.getTime() + 5 * 86400000)));
  const [scanForPii, setScanForPii] = useState(true);
  const [redact, setRedact] = useState(true);
  const [watermark, setWatermark] = useState(true);
  const [allowDownload, setAllowDownload] = useState(false);
  const [requireApproval, setRequireApproval] = useState(true);
  const [scan, setScan] = useState<PiiScan | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [created, setCreated] = useState<{ share: DocumentShare; policyAdjustments: string[] } | null>(null);

  const { data: recipients } = useQuery({
    queryKey: ["share-recipients", doc.id],
    queryFn: async () => (await api.get("/shares/recipients", { params: { documentId: doc.id } })).data.recipients as ShareRecipient[],
    enabled: open,
  });

  useEffect(() => {
    if (!open) {
      setCreated(null);
      setScan(null);
      setBusy(null);
    }
  }, [open]);

  if (!open) return null;

  const highSensitivity = doc.confidentiality === "RESTRICTED" || doc.confidentiality === "HIGHLY_CONFIDENTIAL";
  const redactionActive = scanForPii && redact;

  async function runScan() {
    setBusy("Scanning for PII…");
    try {
      const { data } = await api.post(`/documents/${doc.id}/pii-scans`, {});
      const s = data.scan as PiiScan;
      setScan(s);
      setSelected(new Set(s.findings.map((f) => f.id)));
      if (s.status !== "COMPLETED") notify(s.statusReason ?? "This document could not be scanned.", "danger");
    } catch (err) {
      notify(normalizeApiError(err).message, "danger");
    } finally {
      setBusy(null);
    }
  }

  async function submit() {
    if (!recipientId) return notify("Select a recipient.", "danger");
    if (purpose === "OTHER" && !purposeNote.trim()) return notify("Describe the purpose.", "danger");
    const expiresAt = new Date(`${expiry}T23:59:00`);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt <= new Date()) return notify("Choose a future expiration date.", "danger");

    let redactedDerivativeId: string | undefined;
    try {
      if (redactionActive) {
        if (!scan) return notify("Run the PII scan first so you can review what will be redacted.", "danger");
        if (scan.status !== "COMPLETED") return notify("This document cannot be redacted. Turn off redaction to continue.", "danger");
        if (selected.size > 0) {
          setBusy("Creating redacted copy…");
          const { data } = await api.post(`/documents/${doc.id}/redactions`, { scanId: scan.id, findingIds: [...selected] });
          if (data.derivative.status !== "COMPLETED") {
            setBusy(null);
            return notify(data.derivative.statusReason ?? "Redaction failed; the share was not created.", "danger");
          }
          redactedDerivativeId = data.derivative.id;
        }
      }

      setBusy("Submitting share request…");
      const { data } = await api.post("/shares", {
        documentId: doc.id,
        recipientUserId: recipientId,
        recipientOrganization: recipientOrganization.trim() || undefined,
        purpose,
        purposeNote: purpose === "OTHER" ? purposeNote.trim() : undefined,
        expiresAt: expiresAt.toISOString(),
        allowDownload,
        applyRedaction: !!redactedDerivativeId,
        redactedDerivativeId,
        applyWatermark: watermark || !allowDownload,
        requireApproval,
      });
      setCreated(data);
      onCreated();
    } catch (err) {
      notify(normalizeApiError(err).message, "danger");
    } finally {
      setBusy(null);
    }
  }

  // Portal so layout spacing on the page never offsets the overlay.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-900/40 p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="secure-share-title" className="flex max-h-[92vh] w-full max-w-xl flex-col rounded-lg bg-white shadow-panel">
        <div className="flex items-start justify-between border-b border-border px-6 py-4">
          <div>
            <h2 id="secure-share-title" className="flex items-center gap-2 text-base font-semibold text-ink">
              <Share2 className="h-4 w-4" aria-hidden="true" /> SECURE SHARE
            </h2>
            <p className="mt-0.5 text-sm text-ink-muted">
              {doc.documentNumber} · {doc.title}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close dialog" className="text-ink-subtle hover:text-ink">
            <X className="h-5 w-5" />
          </button>
        </div>

        {created ? (
          <div className="space-y-3 px-6 py-6 text-sm">
            <p className="flex items-center gap-2 font-semibold text-success">
              <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
              {created.share.status === "PENDING" ? "SHARE REQUEST SUBMITTED FOR APPROVAL" : "SHARE ACTIVE"}
            </p>
            <dl className="space-y-1.5">
              <Row label="Recipient" value={`${created.share.recipientOrganization ? `${created.share.recipientOrganization} · ` : ""}${created.share.recipient.fullName}`} />
              <Row label="Purpose" value={created.share.purposeLabel} />
              <Row label="Expires" value={formatDateTime(created.share.expiresAt)} />
              <Row label="Status" value={<StatusBadge status={created.share.status} />} />
              <Row label="Protection" value={[created.share.applyRedaction && "Redacted", created.share.applyWatermark && "Watermarked"].filter(Boolean).join(" + ") || "None"} />
              <Row label="Download" value={created.share.allowDownload ? "Allowed" : "View only"} />
            </dl>
            {created.policyAdjustments.length > 0 && (
              <div className="rounded-md border border-warning/20 bg-warning-bg p-3 text-xs text-ink-muted">
                <p className="font-semibold text-warning">Adjusted by security policy</p>
                {created.policyAdjustments.map((p) => (
                  <p key={p}>{p}</p>
                ))}
              </div>
            )}
            <button className="btn-primary mt-2 w-full" onClick={onClose}>Done</button>
          </div>
        ) : (
          <>
            <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="share-recipient">Recipient</label>
                  <select id="share-recipient" className="input" value={recipientId} onChange={(e) => setRecipientId(e.target.value)}>
                    <option value="">Select a user…</option>
                    {(recipients ?? []).map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.fullName} — {r.roles.map((x) => x.name).join(", ")}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="share-org">Recipient office (optional)</label>
                  <input id="share-org" className="input" placeholder="e.g. Prosecutor Office" value={recipientOrganization} onChange={(e) => setRecipientOrganization(e.target.value)} />
                </div>
                <div>
                  <label className="label" htmlFor="share-purpose">Purpose</label>
                  <select id="share-purpose" className="input" value={purpose} onChange={(e) => setPurpose(e.target.value as SharePurpose)}>
                    {SHARE_PURPOSE_OPTIONS.map((p) => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="share-expiry">Expiration</label>
                  <input id="share-expiry" type="date" className="input" min={isoDate(today)} max={isoDate(new Date(today.getTime() + 89 * 86400000))} value={expiry} onChange={(e) => setExpiry(e.target.value)} />
                </div>
              </div>
              {purpose === "OTHER" && (
                <div>
                  <label className="label" htmlFor="share-purpose-note">Describe the purpose</label>
                  <input id="share-purpose-note" className="input" maxLength={200} value={purposeNote} onChange={(e) => setPurposeNote(e.target.value)} />
                </div>
              )}

              <fieldset className="rounded-md border border-border p-4">
                <legend className="px-1 text-sm font-medium text-ink-muted">Protection</legend>
                <Check label="Scan for PII" checked={scanForPii} onChange={setScanForPii} />
                <Check label="Redact selected PII" checked={redact} disabled={!scanForPii} onChange={setRedact} />
                <Check label="Dynamic watermark (recipient, purpose, date)" checked={watermark || !allowDownload} disabled={!allowDownload} onChange={setWatermark} />
                {!allowDownload && <p className="ml-6 text-xs text-ink-subtle">View-only shares are always watermarked.</p>}

                {scanForPii && (
                  <div className="mt-3 rounded-md bg-surface p-3">
                    {!scan ? (
                      <button type="button" className="btn-secondary" onClick={runScan} disabled={!!busy}>Run PII scan</button>
                    ) : scan.status !== "COMPLETED" ? (
                      <p className="flex items-center gap-1.5 text-xs text-warning"><AlertTriangle className="h-3.5 w-3.5" /> {scan.statusReason}</p>
                    ) : scan.findings.length === 0 ? (
                      <p className="text-xs text-ink-muted">No PII detected by the automated rules (detection is not exhaustive).</p>
                    ) : (
                      <div className="space-y-1.5">
                        <p className="text-xs font-medium text-ink-muted">{redactionActive ? "Select what to redact:" : "Detected (not redacted):"}</p>
                        {scan.findings.map((f) => (
                          <label key={f.id} className="flex items-center gap-2 text-xs text-ink">
                            <input
                              type="checkbox"
                              disabled={!redactionActive}
                              checked={redactionActive && selected.has(f.id)}
                              onChange={() =>
                                setSelected((prev) => {
                                  const next = new Set(prev);
                                  next.has(f.id) ? next.delete(f.id) : next.add(f.id);
                                  return next;
                                })
                              }
                            />
                            <span className="w-40">{f.label}</span>
                            <span className="font-mono">{f.maskedPreview}</span>
                            <span className="ml-auto text-ink-subtle">{f.confidence}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </fieldset>

              <fieldset className="rounded-md border border-border p-4">
                <legend className="px-1 text-sm font-medium text-ink-muted">Permissions</legend>
                <Check label="Allow download" checked={allowDownload} onChange={setAllowDownload} />
                <Check label="Require approval" checked={requireApproval || highSensitivity} disabled={highSensitivity} onChange={setRequireApproval} />
                {highSensitivity && <p className="ml-6 text-xs text-ink-subtle">Approval is mandatory for this classification.</p>}
              </fieldset>

              <p className="text-xs text-ink-subtle">
                The recipient receives a derived copy only. Access ends automatically at the expiration and can be revoked at any time. All actions are audited.
              </p>
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-border px-6 py-4">
              <span className="text-xs text-ink-subtle">{busy}</span>
              <div className="flex gap-2">
                <button className="btn-secondary" onClick={onClose}>Cancel</button>
                <button className="btn-primary" onClick={submit} disabled={!!busy}>Submit request</button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

function Check({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={`flex items-center gap-2 py-1 text-sm ${disabled ? "text-ink-subtle" : "text-ink"}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-ink-subtle">{label}</dt>
      <dd className="text-right text-ink">{value}</dd>
    </div>
  );
}
