import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Link2, ShieldAlert, ShieldCheck, Fingerprint, Loader2 } from "lucide-react";
import { api, normalizeApiError } from "@/lib/api";
import { useToast } from "@/components/Toast";
import { CustodyChainVerificationResult, EvidenceItem, IntegrityVerificationResult } from "@/types";
import { formatDateTime, truncateHash } from "@/lib/format";

function ResultBanner({ ok, label, message }: { ok: boolean; label: string; message: string }) {
  const Icon = ok ? ShieldCheck : ShieldAlert;
  return (
    <div className={clsx("mt-3 rounded-md border p-3", ok ? "border-success/25 bg-success-bg" : "border-danger/25 bg-danger-bg")} role="status">
      <p className={clsx("flex items-center gap-1.5 text-sm font-semibold tracking-wide", ok ? "text-success" : "text-danger")}>
        <Icon className="h-4 w-4" aria-hidden="true" /> {label}
      </p>
      <p className="mt-1 text-xs text-ink-muted">{message}</p>
    </div>
  );
}

function HashLine({ label, value, mismatch }: { label: string; value?: string | null; mismatch?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <span className="text-ink-subtle">{label}</span>
      <code className={clsx("truncate font-mono", mismatch ? "text-danger" : "text-ink-muted")} title={value ?? ""}>
        {value ? truncateHash(value, 14) : "—"}
      </code>
    </div>
  );
}

/** Integrity (content hash) and custody-chain verification for one evidence item. */
export function EvidenceVerificationPanel({
  evidence,
  onChainResult,
}: {
  evidence: EvidenceItem;
  onChainResult?: (result: CustodyChainVerificationResult) => void;
}) {
  const { notify } = useToast();
  const qc = useQueryClient();
  const [integrity, setIntegrity] = useState<IntegrityVerificationResult | null>(null);
  const [chain, setChain] = useState<CustodyChainVerificationResult | null>(null);
  const [busy, setBusy] = useState<"integrity" | "chain" | null>(null);

  const canIntegrity = evidence.allowedActions.includes("VERIFY_INTEGRITY");
  const canChain = evidence.allowedActions.includes("VERIFY_CUSTODY");

  async function verifyIntegrity() {
    setBusy("integrity");
    try {
      const { data } = await api.post(`/evidence/${evidence.id}/verify-integrity`);
      setIntegrity(data);
      qc.invalidateQueries({ queryKey: ["evidence-detail", evidence.id] });
      qc.invalidateQueries({ queryKey: ["custody", evidence.id] });
    } catch (err) {
      notify(normalizeApiError(err).message, "danger");
    } finally {
      setBusy(null);
    }
  }

  async function verifyChain() {
    setBusy("chain");
    try {
      const { data } = await api.post(`/evidence/${evidence.id}/verify-custody`);
      setChain(data);
      onChainResult?.(data);
    } catch (err) {
      notify(normalizeApiError(err).message, "danger");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-ink">Verification</h2>
      <p className="mt-1 text-xs text-ink-subtle">
        Cryptographically verifiable integrity: checks that stored bytes and recorded custody history are unchanged. Supports, but does not by itself establish, evidentiary admissibility.
      </p>

      <div className="mt-4 space-y-4">
        <section>
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-sm font-medium text-ink">
              <Fingerprint className="h-4 w-4 text-teal" aria-hidden="true" /> Content integrity (SHA-256)
            </p>
            {canIntegrity && (
              <button className="btn-secondary px-3 py-1.5 text-xs" onClick={verifyIntegrity} disabled={busy !== null}>
                {busy === "integrity" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />} Verify evidence
              </button>
            )}
          </div>
          {evidence.originalHash ? (
            <div className="mt-2 space-y-1">
              <HashLine label="Registered hash" value={evidence.originalHash} />
              <HashLine label="Current hash" value={integrity ? integrity.currentHash : evidence.currentHash} mismatch={(integrity?.status ?? evidence.integrityStatus) === "VIOLATION"} />
              <p className="text-xs text-ink-subtle">Last verified: {formatDateTime(integrity?.verifiedAt ?? evidence.lastVerifiedAt)}</p>
            </div>
          ) : (
            <p className="mt-2 text-xs text-ink-subtle">No digital file is attached — physical evidence is tracked through its custody chain only.</p>
          )}
          {integrity && <ResultBanner ok={integrity.status === "VERIFIED"} label={integrity.label} message={integrity.message} />}
        </section>

        <section className="border-t border-border pt-4">
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-sm font-medium text-ink">
              <Link2 className="h-4 w-4 text-teal" aria-hidden="true" /> Custody hash chain
            </p>
            {canChain && (
              <button className="btn-secondary px-3 py-1.5 text-xs" onClick={verifyChain} disabled={busy !== null}>
                {busy === "chain" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />} Verify custody chain
              </button>
            )}
          </div>
          <div className="mt-2 space-y-1">
            <HashLine label="Chain head" value={evidence.custodyHeadHash} />
            <p className="text-xs text-ink-subtle">{evidence.custodyEventCount} hash-linked custody entries</p>
          </div>
          {chain && (
            <>
              <ResultBanner ok={chain.status === "VERIFIED"} label={chain.label} message={`${chain.message} (${chain.eventsChecked} entries checked)`} />
              {chain.failures.length > 0 && (
                <ul className="mt-2 space-y-2">
                  {chain.failures.map((f, i) => (
                    <li key={i} className="rounded-md border border-danger/20 p-2 text-xs">
                      <p className="font-medium text-danger">
                        {f.code.replace(/_/g, " ")}
                        {f.sequence != null && ` · entry #${f.sequence}`}
                      </p>
                      <p className="text-ink-muted">{f.message}</p>
                      {(f.expectedHash || f.storedHash) && (
                        <div className="mt-1 space-y-0.5">
                          <HashLine label="Expected" value={f.expectedHash} />
                          <HashLine label="Stored" value={f.storedHash} mismatch />
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>
        {!canIntegrity && !canChain && <p className="text-xs text-ink-subtle">Your role does not include evidence.verify for this item.</p>}
      </div>
    </div>
  );
}
