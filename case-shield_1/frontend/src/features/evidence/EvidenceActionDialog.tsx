import { useState } from "react";
import { api, normalizeApiError } from "@/lib/api";
import { useToast } from "@/components/Toast";
import { EvidenceItem } from "@/types";
import { DIRECT_ACTIONS, DirectUiAction } from "@/lib/evidence";
import { EvidenceDialogShell } from "@/features/evidence/EvidenceDialogShell";

// One dialog for every custody action that needs a reason: the lifecycle
// actions (examine, seal, …) and rejecting/cancelling a pending transfer.
// The server re-validates custodian, permission and lifecycle every time.

export type EvidenceDialogAction = DirectUiAction | "REJECT_TRANSFER" | "CANCEL_TRANSFER";

const TRANSFER_COPY = {
  REJECT_TRANSFER: { label: "Reject transfer", placeholder: "e.g. Package seal damaged on arrival" },
  CANCEL_TRANSFER: { label: "Cancel transfer", placeholder: "e.g. Recipient unavailable" },
};

export function EvidenceActionDialog({
  evidence,
  action,
  onClose,
  onDone,
}: {
  evidence: EvidenceItem;
  action: EvidenceDialogAction;
  onClose: () => void;
  onDone: (updated: EvidenceItem) => void;
}) {
  const { notify } = useToast();
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isTransfer = action === "REJECT_TRANSFER" || action === "CANCEL_TRANSFER";
  const label = isTransfer ? TRANSFER_COPY[action].label : DIRECT_ACTIONS[action].label;
  const placeholder = isTransfer ? TRANSFER_COPY[action].placeholder : DIRECT_ACTIONS[action].reasonPlaceholder;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (reason.trim().length < 3) return setError("A reason is required.");
    setSubmitting(true);
    try {
      let data;
      if (isTransfer) {
        const verb = action === "REJECT_TRANSFER" ? "reject" : "cancel";
        ({ data } = await api.post(`/evidence/${evidence.id}/transfers/${evidence.pendingTransfer!.id}/${verb}`, { reason: reason.trim() }));
      } else {
        ({ data } = await api.post(`/evidence/${evidence.id}/actions`, {
          action: DIRECT_ACTIONS[action].action,
          reason: reason.trim(),
          notes: notes.trim() || undefined,
        }));
      }
      notify(`${label}: recorded in the chain of custody.`, "success");
      onDone(data.evidence);
    } catch (err) {
      setError(normalizeApiError(err).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <EvidenceDialogShell id="evidence-action-title" title={label} subtitle={`${evidence.evidenceNumber} · ${evidence.title}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4 px-6 py-5" noValidate>
        <div>
          <label className="label" htmlFor="ea-reason">Reason</label>
          <input id="ea-reason" className="input" placeholder={placeholder} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} autoFocus />
        </div>
        {!isTransfer && (
          <div>
            <label className="label" htmlFor="ea-notes">Notes (optional)</label>
            <textarea id="ea-notes" rows={3} className="input" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
          </div>
        )}
        <p className="text-xs text-ink-subtle">Recorded with your identity and a server timestamp. Custody entries cannot be edited afterwards.</p>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className={action === "REJECT_TRANSFER" ? "btn-danger" : "btn-primary"} disabled={submitting}>
            {submitting ? "Recording…" : label}
          </button>
        </div>
      </form>
    </EvidenceDialogShell>
  );
}
