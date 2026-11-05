import { useState, ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles, RefreshCw, Info, Lock, ScanText, Tags, FileSearch, ChevronDown, ChevronUp, Check, X, Pencil, AlertTriangle } from "lucide-react";
import { api, normalizeApiError } from "@/lib/api";
import { useToast } from "@/components/Toast";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDateTime } from "@/lib/format";
import {
  APPLICABLE_DOCUMENT_TYPES,
  CLASSIFICATION_TYPES,
  EDITABLE_METADATA_FIELDS,
  confidenceTone,
  formatMetadataValue,
  percent,
  typeLabel,
} from "@/lib/intelligence";
import { DocumentIntelligence, DocumentIntelligenceResponse, ReviewDecision, StructuredDocumentMetadata } from "@/types";

/**
 * Phase 4 Document Intelligence panel: processing status, extracted/OCR text
 * (PII-masked preview), AI classification, structured metadata and summary,
 * each with its provenance and a human review action. All AI output is
 * labeled as a suggestion; the backend enforces every permission and policy.
 */
export function DocumentIntelligencePanel({ documentId }: { documentId: string }) {
  const qc = useQueryClient();
  const { notify } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [showText, setShowText] = useState(false);

  const query = useQuery({
    queryKey: ["document-intelligence", documentId],
    queryFn: async () => (await api.get(`/documents/${documentId}/intelligence`)).data as DocumentIntelligenceResponse,
    // Poll while the background pipeline is working.
    refetchInterval: (q) => {
      const status = q.state.data?.intelligence?.processing.status;
      return status === "QUEUED" || status === "PROCESSING" ? 2000 : false;
    },
  });

  async function run(key: string, action: () => Promise<unknown>, success: string) {
    setBusy(key);
    try {
      await action();
      notify(success, "success");
      await qc.invalidateQueries({ queryKey: ["document-intelligence", documentId] });
      qc.invalidateQueries({ queryKey: ["document", documentId] });
    } catch (err) {
      notify(normalizeApiError(err).message, "danger");
    } finally {
      setBusy(null);
    }
  }

  if (query.isLoading) {
    return (
      <Section>
        <p className="text-sm text-ink-subtle">Loading document intelligence…</p>
      </Section>
    );
  }
  if (query.error || !query.data) {
    return (
      <Section>
        <p className="text-sm text-danger">{normalizeApiError(query.error).message}</p>
      </Section>
    );
  }

  const { intelligence: intel, policy, capabilities, document } = query.data;
  const active = intel?.processing.status === "QUEUED" || intel?.processing.status === "PROCESSING";

  const reprocessButton = capabilities.canReprocess && (
    <button
      className="btn-secondary"
      disabled={active || busy !== null}
      onClick={() => run("reprocess", () => api.post(`/documents/${documentId}/intelligence/reprocess`), "Processing queued.")}
    >
      <RefreshCw className={`h-4 w-4 ${active ? "animate-spin" : ""}`} aria-hidden="true" />
      {intel ? (active ? "Processing…" : "Reprocess") : "Process document"}
    </button>
  );

  return (
    <Section action={reprocessButton}>
      <div className="flex items-start gap-2 rounded-md border border-teal/20 bg-teal/5 p-3 text-xs text-teal-dark">
        <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
        <p>
          {intel?.disclaimer ?? "AI-generated, non-authoritative. Not legal advice and not a legal determination."} Suggestions stay
          “AI generated” until an authorized user confirms or corrects them.
        </p>
      </div>

      {policy.restricted && (
        <div className="flex items-start gap-2 rounded-md border border-border bg-navy-50 p-3 text-xs text-ink-muted">
          <Lock className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
          <p>{policy.restrictedReason} Text from the file's own text layer is still indexed for authorized search.</p>
        </div>
      )}

      {!intel ? (
        <p className="text-sm text-ink-muted">
          This version has not been processed yet{capabilities.canReprocess ? "." : ". Ask a user with AI processing permission to process it."}
        </p>
      ) : (
        <>
          <ProcessingSummary intel={intel} versionNumber={document.versionNumber} />
          <ExtractionBlock intel={intel} showText={showText} onToggle={() => setShowText((v) => !v)} />
          <ClassificationBlock
            intel={intel}
            canReview={capabilities.canReview && !active}
            canApplyType={capabilities.canApplyType}
            busy={busy}
            onReview={(body) =>
              run("classification", () => api.post(`/documents/${documentId}/intelligence/classification/review`, body), "Classification review saved.")
            }
          />
          <MetadataBlock
            intel={intel}
            canReview={capabilities.canReview && !active}
            busy={busy}
            onReview={(body) => run("metadata", () => api.post(`/documents/${documentId}/intelligence/metadata/review`, body), "Metadata review saved.")}
          />
          <SummaryBlock
            intel={intel}
            canRegenerate={capabilities.canReprocess && !policy.restricted && !active && !!intel.extraction.textPreview}
            busy={busy}
            onRegenerate={() => run("summary", () => api.post(`/documents/${documentId}/intelligence/summary`), "Summary regenerated.")}
          />
          <p className="text-[11px] text-ink-subtle">
            Providers: AI — {policy.aiProvider}; OCR — {policy.ocrProvider}.
          </p>
        </>
      )}
    </Section>
  );
}

function Section({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <section className="card space-y-4 p-5" aria-labelledby="intelligence-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="intelligence-heading" className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Sparkles className="h-4 w-4" aria-hidden="true" /> Document intelligence
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Step({ title, icon: Icon, status, children, extra }: { title: string; icon: typeof Info; status: string; children: ReactNode; extra?: ReactNode }) {
  return (
    <div className="rounded-md border border-border p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-medium text-ink">
          <Icon className="h-4 w-4 text-ink-subtle" aria-hidden="true" /> {title}
        </h3>
        <div className="flex flex-wrap items-center gap-1.5">
          {extra}
          <StatusBadge status={status} />
        </div>
      </div>
      {children}
    </div>
  );
}

function ProcessingSummary({ intel, versionNumber }: { intel: DocumentIntelligence; versionNumber: number }) {
  const p = intel.processing;
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
      <div className="flex items-center gap-2">
        <span className="text-ink-subtle">Processing (v{versionNumber})</span>
        <StatusBadge status={p.status} />
      </div>
      <span className="text-xs text-ink-subtle">Attempt {p.attempts || 1}</span>
      {p.completedAt && <span className="text-xs text-ink-subtle">Finished {formatDateTime(p.completedAt)}</span>}
      {!p.completedAt && <span className="text-xs text-ink-subtle">Queued {formatDateTime(p.queuedAt)}</span>}
      {p.error && (
        <p className="flex w-full items-center gap-1.5 text-xs text-danger">
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> {p.error}
        </p>
      )}
    </div>
  );
}

function ExtractionBlock({ intel, showText, onToggle }: { intel: DocumentIntelligence; showText: boolean; onToggle: () => void }) {
  const e = intel.extraction;
  const piiTypes = Object.entries(intel.pii.typeCounts);
  return (
    <Step title="Text extraction" icon={ScanText} status={e.status}>
      <dl className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
        <Meta label="Source" value={e.textSource === "OCR" ? "OCR" : e.textSource === "TEXT_LAYER" ? "Text layer" : "—"} />
        <Meta label="Confidence" value={<span className={confidenceTone(e.confidence)}>{percent(e.confidence)}</span>} />
        <Meta label="Pages" value={e.pageCount ?? "—"} />
        <Meta label="Language" value={e.language ?? "—"} />
      </dl>
      {e.error && <p className="mt-2 text-xs text-danger">{e.error}</p>}
      {e.limitations.length > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-warning">
          {e.limitations.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
      {intel.pii.status === "COMPLETED" && (
        <p className="mt-2 text-xs text-ink-muted">
          PII detected: {intel.pii.findingCount ?? 0}
          {piiTypes.length > 0 && ` (${piiTypes.map(([t, n]) => `${t.replace(/_/g, " ").toLowerCase()} ×${n}`).join(", ")})`} — masked in all derived text, search and AI input.
        </p>
      )}
      {e.textPreview && (
        <div className="mt-3">
          <button className="btn-ghost -ml-2 px-2 py-1 text-xs" onClick={onToggle} aria-expanded={showText}>
            {showText ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />} {showText ? "Hide" : "Show"} extracted text (PII-masked)
          </button>
          {showText && (
            <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-navy-50 p-3 font-mono text-xs text-ink-muted">
              {e.textPreview}
              {e.textTruncated && "\n\n… (preview truncated)"}
            </pre>
          )}
        </div>
      )}
    </Step>
  );
}

function ClassificationBlock({
  intel,
  canReview,
  canApplyType,
  busy,
  onReview,
}: {
  intel: DocumentIntelligence;
  canReview: boolean;
  canApplyType: boolean;
  busy: string | null;
  onReview: (body: { decision: ReviewDecision; type?: string; applyToDocument?: boolean }) => void;
}) {
  const c = intel.classification;
  const [correcting, setCorrecting] = useState(false);
  const [type, setType] = useState<string>(c.suggestedType ?? "OTHER");
  const [apply, setApply] = useState(false);
  const reviewable = canReview && c.status === "COMPLETED" && !!c.suggestedType;
  const effectiveType = c.review === "CONFIRMED" ? c.confirmedType : c.suggestedType;

  return (
    <Step title="Classification" icon={Tags} status={c.status} extra={c.provenance && <StatusBadge status={c.provenance} />}>
      {c.status === "COMPLETED" ? (
        <div className="space-y-2 text-sm">
          <p>
            <span className="font-medium text-ink">{typeLabel(effectiveType)}</span>
            {c.review !== "CONFIRMED" && (
              <span className={`ml-2 text-xs ${confidenceTone(c.confidence)}`}>AI confidence {percent(c.confidence)}</span>
            )}
            {c.review === "CONFIRMED" && c.confirmedType !== c.suggestedType && (
              <span className="ml-2 text-xs text-ink-subtle">(AI suggested {typeLabel(c.suggestedType)})</span>
            )}
          </p>
          {c.reason && <p className="text-xs text-ink-subtle">{c.reason}</p>}
          <p className="text-xs text-ink-subtle">
            Review: <StatusBadge status={c.review} />
            {c.reviewedAt && ` · ${formatDateTime(c.reviewedAt)}`}
          </p>
          {reviewable && !correcting && (
            <div className="flex flex-wrap gap-2 pt-1">
              <button className="btn-secondary px-3 py-1.5 text-xs" disabled={busy !== null} onClick={() => onReview({ decision: "CONFIRM" })}>
                <Check className="h-3.5 w-3.5" /> Confirm
              </button>
              <button className="btn-secondary px-3 py-1.5 text-xs" disabled={busy !== null} onClick={() => setCorrecting(true)}>
                <Pencil className="h-3.5 w-3.5" /> Correct
              </button>
              <button className="btn-ghost px-3 py-1.5 text-xs" disabled={busy !== null} onClick={() => onReview({ decision: "REJECT" })}>
                <X className="h-3.5 w-3.5" /> Reject
              </button>
            </div>
          )}
          {reviewable && correcting && (
            <form
              className="flex flex-wrap items-end gap-3 pt-1"
              onSubmit={(ev) => {
                ev.preventDefault();
                onReview({ decision: "CORRECT", type, applyToDocument: apply && APPLICABLE_DOCUMENT_TYPES.has(type as any) });
                setCorrecting(false);
              }}
            >
              <label className="text-xs">
                <span className="label text-xs">Correct type</span>
                <select className="input py-1.5" value={type} onChange={(ev) => setType(ev.target.value)}>
                  {CLASSIFICATION_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {typeLabel(t)}
                    </option>
                  ))}
                </select>
              </label>
              {canApplyType && (
                <label className="flex items-center gap-2 pb-2 text-xs text-ink-muted">
                  <input type="checkbox" checked={apply} disabled={!APPLICABLE_DOCUMENT_TYPES.has(type as any)} onChange={(ev) => setApply(ev.target.checked)} />
                  Also record as the document's type
                </label>
              )}
              <button type="submit" className="btn-primary px-3 py-1.5 text-xs" disabled={busy !== null}>
                Save correction
              </button>
              <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={() => setCorrecting(false)}>
                Cancel
              </button>
            </form>
          )}
        </div>
      ) : (
        <p className="text-xs text-ink-subtle">{c.reason ?? "Not available yet."}</p>
      )}
    </Step>
  );
}

type Draft = Record<string, string>;

function MetadataBlock({
  intel,
  canReview,
  busy,
  onReview,
}: {
  intel: DocumentIntelligence;
  canReview: boolean;
  busy: string | null;
  onReview: (body: { decision: ReviewDecision; metadata?: Record<string, unknown> }) => void;
}) {
  const m = intel.metadata;
  const shown = (m.review === "CONFIRMED" ? m.confirmed : m.extracted) as Partial<StructuredDocumentMetadata> | null;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>({});

  function startEdit() {
    const d: Draft = {};
    for (const f of EDITABLE_METADATA_FIELDS) d[f.key] = formatMetadataValue(shown?.[f.key]?.value);
    setDraft(d);
    setEditing(true);
  }

  function submitEdit(ev: React.FormEvent) {
    ev.preventDefault();
    const metadata: Record<string, unknown> = {};
    for (const f of EDITABLE_METADATA_FIELDS) {
      const before = formatMetadataValue(shown?.[f.key]?.value);
      const raw = (draft[f.key] ?? "").trim();
      if (raw === before) continue;
      metadata[f.key] = raw === "" ? null : f.kind === "list" ? raw.split(",").map((v) => v.trim()).filter(Boolean) : raw;
    }
    if (Object.keys(metadata).length === 0) {
      setEditing(false);
      return;
    }
    onReview({ decision: "CORRECT", metadata });
    setEditing(false);
  }

  const rows = shown
    ? (Object.entries(shown) as [keyof StructuredDocumentMetadata, { value: unknown; confidence: number } | undefined][]).map(([key, field]) => ({
        key,
        label: EDITABLE_METADATA_FIELDS.find((f) => f.key === key)?.label ?? (key === "parties" ? "Parties" : key === "identifiers" ? "Identifiers" : key === "documentType" ? "Document type" : key),
        value: key === "documentType" ? typeLabel(field?.value as string) : formatMetadataValue(field?.value),
        confidence: field?.confidence,
        present: field?.value !== null && field?.value !== undefined && !(Array.isArray(field?.value) && field!.value.length === 0),
      }))
    : [];

  return (
    <Step title="Extracted metadata" icon={FileSearch} status={m.status} extra={m.provenance && <StatusBadge status={m.provenance} />}>
      {m.status !== "COMPLETED" || !shown ? (
        <p className="text-xs text-ink-subtle">{m.reason ?? "Not available yet."}</p>
      ) : editing ? (
        <form className="grid grid-cols-1 gap-3 sm:grid-cols-2" onSubmit={submitEdit}>
          {EDITABLE_METADATA_FIELDS.map((f) => (
            <label key={f.key} className="text-xs">
              <span className="label text-xs">
                {f.label}
                {f.kind === "list" && " (comma-separated)"}
              </span>
              <input
                className="input py-1.5"
                type={f.kind === "date" ? "date" : "text"}
                value={draft[f.key] ?? ""}
                onChange={(ev) => setDraft((d) => ({ ...d, [f.key]: ev.target.value }))}
              />
            </label>
          ))}
          <div className="flex gap-2 sm:col-span-2">
            <button type="submit" className="btn-primary px-3 py-1.5 text-xs" disabled={busy !== null}>
              Save corrections
            </button>
            <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          <table className="w-full text-sm">
            <caption className="sr-only">Extracted metadata fields with confidence</caption>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-b border-border last:border-0">
                  <th scope="row" className="py-1.5 pr-3 text-left text-xs font-normal text-ink-subtle">
                    {r.label}
                  </th>
                  <td className="py-1.5 text-ink">{r.present ? r.value : <span className="text-xs italic text-ink-subtle">Not found</span>}</td>
                  <td className={`py-1.5 pl-3 text-right text-xs ${confidenceTone(r.present ? r.confidence : null)}`}>{r.present ? percent(r.confidence) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-ink-subtle">
            Review: <StatusBadge status={m.review} />
            {m.reviewedAt && ` · ${formatDateTime(m.reviewedAt)}`}. Unknown values are left blank — never guessed.
          </p>
          {canReview && (
            <div className="mt-2 flex flex-wrap gap-2">
              {m.review !== "CONFIRMED" && (
                <button className="btn-secondary px-3 py-1.5 text-xs" disabled={busy !== null} onClick={() => onReview({ decision: "CONFIRM" })}>
                  <Check className="h-3.5 w-3.5" /> Confirm all
                </button>
              )}
              <button className="btn-secondary px-3 py-1.5 text-xs" disabled={busy !== null} onClick={startEdit}>
                <Pencil className="h-3.5 w-3.5" /> Edit
              </button>
              {m.review !== "REJECTED" && (
                <button className="btn-ghost px-3 py-1.5 text-xs" disabled={busy !== null} onClick={() => onReview({ decision: "REJECT" })}>
                  <X className="h-3.5 w-3.5" /> Reject
                </button>
              )}
            </div>
          )}
        </>
      )}
    </Step>
  );
}

function SummaryBlock({ intel, canRegenerate, busy, onRegenerate }: { intel: DocumentIntelligence; canRegenerate: boolean; busy: string | null; onRegenerate: () => void }) {
  const s = intel.summary;
  return (
    <Step title="AI summary" icon={Sparkles} status={s.status} extra={s.provenance && <StatusBadge status={s.provenance} />}>
      {s.text ? (
        <>
          <p className="text-sm leading-relaxed text-ink">{s.text}</p>
          <p className="mt-2 text-xs text-ink-subtle">
            Generated {formatDateTime(s.generatedAt)} by {s.provider}. Read the source document before relying on this summary.
          </p>
        </>
      ) : (
        <p className="text-xs text-ink-subtle">{s.reason ?? "Not available yet."}</p>
      )}
      {canRegenerate && (
        <button className="btn-ghost -ml-2 mt-2 px-2 py-1 text-xs" disabled={busy !== null} onClick={onRegenerate}>
          <RefreshCw className="h-3.5 w-3.5" /> {busy === "summary" ? "Regenerating…" : "Regenerate summary"}
        </button>
      )}
    </Step>
  );
}

function Meta({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-ink-subtle">{label}</dt>
      <dd className="mt-0.5 text-ink">{value}</dd>
    </div>
  );
}
