import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, normalizeApiError } from "@/lib/api";
import { useToast } from "@/components/Toast";
import { CustodianCandidate, EvidenceItem } from "@/types";
import { EvidenceDialogShell } from "@/features/evidence/EvidenceDialogShell";
import { AlertTriangle } from "lucide-react";

export function TransferEvidenceDialog({
  evidence,
  onClose,
  onDone,
}: {
  evidence: EvidenceItem;
  onClose: () => void;
  onDone: (updated: EvidenceItem) => void;
}) {
  const { notify } = useToast();
  const [toUserId, setToUserId] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: candidates, isLoading } = useQuery({
    queryKey: ["transfer-candidates", evidence.id],
    queryFn: async () => (await api.get(`/evidence/${evidence.id}/transfer-candidates`)).data.candidates as CustodianCandidate[],
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!toUserId) return setError("Choose a recipient.");
    if (reason.trim().length < 3) return setError("A reason for the transfer is required.");
    setSubmitting(true);
    try {
      const { data } = await api.post(`/evidence/${evidence.id}/transfers`, { toUserId, reason: reason.trim(), notes: notes.trim() || undefined });
      notify(`Transfer of ${evidence.evidenceNumber} initiated — pending receipt.`, "success");
      onDone(data.evidence);
    } catch (err) {
      setError(normalizeApiError(err).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <EvidenceDialogShell id="transfer-evidence-title" title="Transfer evidence" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4 px-6 py-5" noValidate>
        <dl className="grid grid-cols-2 gap-3 rounded-md bg-surface p-3 text-sm">
          <div>
            <dt className="text-xs text-ink-subtle">Evidence</dt>
            <dd className="font-mono font-medium text-ink">{evidence.evidenceNumber}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-subtle">Current custodian</dt>
            <dd className="font-medium text-ink">{evidence.currentCustodian?.fullName ?? "—"}</dd>
          </div>
        </dl>

        <div>
          <label className="label" htmlFor="tr-to">Transfer to</label>
          <select id="tr-to" className="input" value={toUserId} onChange={(e) => setToUserId(e.target.value)} disabled={isLoading}>
            <option value="">{isLoading ? "Loading authorized recipients…" : "Select a recipient"}</option>
            {candidates?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.fullName}
                {c.roles[0] ? ` — ${c.roles[0].name}` : ""}
              </option>
            ))}
          </select>
          {candidates && candidates.length === 0 && (
            <p className="mt-1 text-xs text-ink-subtle">No other active case member is authorized to receive this evidence.</p>
          )}
        </div>
        <div>
          <label className="label" htmlFor="tr-reason">Reason</label>
          <input id="tr-reason" className="input" placeholder="e.g. Forensic examination" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </div>
        <div>
          <label className="label" htmlFor="tr-notes">Notes (optional)</label>
          <textarea id="tr-notes" rows={2} className="input" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
        </div>

        <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning-bg p-3 text-xs text-ink-muted">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-warning" aria-hidden="true" />
          <span>
            The transfer will be recorded in the chain of custody. You remain the custodian until the recipient accepts receipt.
          </span>
        </div>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={submitting}>{submitting ? "Initiating…" : "Initiate transfer"}</button>
        </div>
      </form>
    </EvidenceDialogShell>
  );
}
