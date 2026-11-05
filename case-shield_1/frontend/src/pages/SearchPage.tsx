import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { api, normalizeApiError } from "@/lib/api";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { Search as SearchIcon, FolderKanban, FileText, Shield, Sparkles, Info } from "lucide-react";
import clsx from "clsx";
import { CLASSIFICATION_TYPES, snippetParts, typeLabel } from "@/lib/intelligence";
import { formatDate } from "@/lib/format";
import { DocumentSearchHit, DocumentSearchResponse, SearchMatchSource } from "@/types";

const TYPES = [
  { key: undefined, label: "All" },
  { key: "case", label: "Cases" },
  { key: "document", label: "Documents" },
  { key: "evidence", label: "Evidence" },
] as const;

const ICONS: Record<string, any> = { case: FolderKanban, document: FileText, evidence: Shield };

const MATCH_LABELS: Record<SearchMatchSource, string> = {
  title: "title",
  number: "document / case number",
  tags: "tags",
  metadata: "extracted metadata",
  text: "document text",
  semantic: "semantic similarity",
};

type DocFilters = { mode: "keyword" | "intelligent"; documentType: string; dateFrom: string; dateTo: string };

export function SearchPage() {
  const [params] = useSearchParams();
  const initialQ = params.get("q") ?? "";
  const initialTab = params.get("tab");
  const [q, setQ] = useState(initialQ);
  const [type, setType] = useState<string | undefined>(initialTab && ["case", "document", "evidence"].includes(initialTab) ? initialTab : undefined);
  const [submitted, setSubmitted] = useState(initialQ);
  // The header search box navigates here with ?q=; follow later changes too.
  useEffect(() => {
    if (!initialQ) return;
    setQ(initialQ);
    setSubmitted(initialQ);
    if (initialTab) setType(initialTab);
  }, [initialQ, initialTab]);
  const [filters, setFilters] = useState<DocFilters>({ mode: "keyword", documentType: "", dateFrom: "", dateTo: "" });
  const [submittedFilters, setSubmittedFilters] = useState<DocFilters>(filters);

  const isDocumentSearch = type === "document";
  const hasDocFilter = !!(submittedFilters.documentType || submittedFilters.dateFrom || submittedFilters.dateTo);

  const records = useQuery({
    queryKey: ["search", submitted, type],
    queryFn: async () => (await api.get("/search", { params: { q: submitted, type } })).data.results as any[],
    enabled: !isDocumentSearch && submitted.length > 0,
  });

  const documents = useQuery({
    queryKey: ["search-documents", submitted, submittedFilters],
    queryFn: async () =>
      (
        await api.get("/search/documents", {
          params: {
            q: submitted,
            mode: submittedFilters.mode,
            documentType: submittedFilters.documentType || undefined,
            dateFrom: submittedFilters.dateFrom || undefined,
            dateTo: submittedFilters.dateTo || undefined,
          },
        })
      ).data as DocumentSearchResponse,
    enabled: isDocumentSearch && (submitted.length > 0 || hasDocFilter),
  });

  const started = submitted.length > 0 || (isDocumentSearch && hasDocFilter);

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold text-ink">Search</h1>
      <p className="text-sm text-ink-muted">
        Results are filtered to what you are authorized to see — a case, document, or evidence record you cannot
        access will never appear here, even as a partial match.
      </p>

      <form
        className="card space-y-3 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(q.trim());
          setSubmittedFilters(filters);
        }}
      >
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" aria-hidden="true" />
            <input
              className="input pl-9"
              placeholder={
                isDocumentSearch
                  ? filters.mode === "intelligent"
                    ? 'Ask, e.g. "witness statements about the parking theft in CASE-2024-00042"'
                    : "Search document text, titles and extracted metadata…"
                  : "Search cases, documents, evidence…"
              }
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search query"
            />
          </div>
          <button type="submit" className="btn-primary">
            Search
          </button>
        </div>

        {isDocumentSearch && (
          <div className="flex flex-wrap items-end gap-3 border-t border-border pt-3">
            <fieldset className="flex flex-col" aria-label="Search mode">
              <span className="label text-xs">Mode</span>
              <div className="flex gap-1">
              {(["keyword", "intelligent"] as const).map((m) => (
                <button
                  type="button"
                  key={m}
                  aria-pressed={filters.mode === m}
                  onClick={() => setFilters((f) => ({ ...f, mode: m }))}
                  className={clsx(
                    "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium",
                    filters.mode === m ? "bg-navy-700 text-white" : "border border-border bg-white text-ink-muted hover:bg-navy-50",
                  )}
                >
                  {m === "intelligent" && <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />}
                  {m === "keyword" ? "Keyword" : "Intelligent (AI-assisted)"}
                </button>
              ))}
              </div>
            </fieldset>
            <label className="text-xs">
              <span className="label text-xs">Document type</span>
              <select className="input py-1.5" value={filters.documentType} onChange={(e) => setFilters((f) => ({ ...f, documentType: e.target.value }))}>
                <option value="">Any type</option>
                {CLASSIFICATION_TYPES.filter((t) => t !== "OTHER").map((t) => (
                  <option key={t} value={t}>
                    {typeLabel(t)}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs">
              <span className="label text-xs">From</span>
              <input type="date" className="input py-1.5" value={filters.dateFrom} onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value }))} />
            </label>
            <label className="text-xs">
              <span className="label text-xs">To</span>
              <input type="date" className="input py-1.5" value={filters.dateTo} onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value }))} />
            </label>
          </div>
        )}
      </form>

      <div className="flex gap-1">
        {TYPES.map((t) => (
          <button
            key={t.label}
            onClick={() => setType(t.key)}
            className={clsx(
              "rounded-md px-3 py-1.5 text-xs font-medium",
              type === t.key ? "bg-navy-700 text-white" : "bg-white text-ink-muted border border-border hover:bg-navy-50",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {!started ? (
        <EmptyState
          icon={SearchIcon}
          title="Search across your authorized cases"
          description={
            isDocumentSearch
              ? "Document search looks inside extracted and OCR text (PII-masked), AI-extracted metadata and titles."
              : "Enter a query above to search case titles, document titles, and evidence descriptions."
          }
        />
      ) : isDocumentSearch ? (
        <DocumentResults query={documents} />
      ) : records.isLoading ? (
        <p className="text-sm text-ink-subtle">Searching…</p>
      ) : (records.data?.length ?? 0) === 0 ? (
        <EmptyState icon={SearchIcon} title="No matches found" description="Try a different search term, or verify you have access to the relevant case." />
      ) : (
        <ul className="space-y-2">
          {records.data!.map((r) => {
            const Icon = ICONS[r.kind] ?? FileText;
            const to = r.kind === "case" ? `/cases/${r.id}` : r.kind === "document" ? `/documents/${r.id}` : `/cases/${r.caseId}/evidence/${r.id}`;
            return (
              <li key={`${r.kind}-${r.id}`}>
                <Link to={to} className="card flex items-center gap-3 p-4 hover:border-teal">
                  <Icon className="h-4.5 w-4.5 flex-shrink-0 text-ink-subtle" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{r.title}</p>
                    <p className="text-xs text-ink-subtle">{r.subtitle}</p>
                  </div>
                  {r.status && <StatusBadge status={r.status} />}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function DocumentResults({ query }: { query: { isLoading: boolean; error: unknown; data?: DocumentSearchResponse } }) {
  if (query.isLoading) return <p className="text-sm text-ink-subtle">Searching…</p>;
  if (query.error) return <p className="text-sm text-danger">{normalizeApiError(query.error).message}</p>;
  const data = query.data;
  if (!data) return null;

  return (
    <div className="space-y-3">
      {data.interpretation && <Interpretation data={data} />}
      <p className="text-xs text-ink-subtle">
        {data.total} matching document{data.total === 1 ? "" : "s"} you can access · {data.tookMs} ms
        {data.ranking.semanticError && <span className="ml-2 text-warning">{data.ranking.semanticError}</span>}
      </p>
      {data.results.length === 0 ? (
        <EmptyState icon={SearchIcon} title="No matches found" description="Try different words, remove a filter, or switch search mode." />
      ) : (
        <ul className="space-y-2">
          {data.results.map((r) => (
            <DocumentHit key={r.documentId} hit={r} />
          ))}
        </ul>
      )}
    </div>
  );
}

function Interpretation({ data }: { data: DocumentSearchResponse }) {
  const i = data.interpretation!;
  const chips = [
    ...i.documentTypes.map((t) => `type: ${typeLabel(t)}`),
    ...i.caseNumbers.map((c) => `case: ${c}`),
    ...i.evidenceNumbers.map((e) => `evidence: ${e}`),
    ...(i.dateFrom ? [`from ${i.dateFrom}`] : []),
    ...(i.dateTo ? [`to ${i.dateTo}`] : []),
    ...i.keywords.map((k) => `“${k}”`),
  ];
  return (
    <div className="flex items-start gap-2 rounded-md border border-teal/20 bg-teal/5 p-3 text-xs text-teal-dark">
      <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
      <div>
        <p>
          Interpreted as{i.fallback ? " (heuristic fallback — AI interpretation unavailable)" : ""}:{" "}
          {chips.length ? chips.map((c) => <span key={c} className="mr-1.5 inline-block rounded bg-white/70 px-1.5 py-0.5">{c}</span>) : "no filters"}
        </p>
        <p className="mt-1 text-ink-subtle">
          The interpretation only narrows your authorized results; it never widens access.
          {data.ranking.semanticProvider && ` Re-ranked by ${data.ranking.semanticProvider}.`}
        </p>
      </div>
    </div>
  );
}

function DocumentHit({ hit }: { hit: DocumentSearchHit }) {
  const aiType = hit.confirmedType ?? hit.suggestedType;
  return (
    <li>
      <Link to={`/documents/${hit.documentId}`} className="card block p-4 hover:border-teal">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-ink">{hit.title}</p>
            <p className="text-xs text-ink-subtle">
              {hit.documentNumber} · {hit.caseNumber}
              {hit.documentDate ? ` · dated ${hit.documentDate}` : ` · uploaded ${formatDate(hit.createdAt)}`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {aiType && <StatusBadge status={hit.confirmedType ? "HUMAN_CONFIRMED" : "AI_GENERATED"} label={`${typeLabel(aiType)}${hit.confirmedType ? "" : " (AI)"}`} />}
            <StatusBadge status={hit.confidentiality} />
            {hit.processingStatus && hit.processingStatus !== "COMPLETED" && <StatusBadge status={hit.processingStatus} />}
          </div>
        </div>
        {hit.snippet && (
          <p className="mt-2 text-sm text-ink-muted">
            {snippetParts(hit.snippet).map((p, i) =>
              p.match ? (
                <mark key={i} className="rounded bg-warning-bg px-0.5 text-ink">
                  {p.text}
                </mark>
              ) : (
                <span key={i}>{p.text}</span>
              ),
            )}
          </p>
        )}
        {!hit.snippet && hit.summary && <p className="mt-2 line-clamp-2 text-sm text-ink-muted">{hit.summary}</p>}
        <p className="mt-2 text-[11px] text-ink-subtle">Matched on {hit.matchedOn.length ? hit.matchedOn.map((m) => MATCH_LABELS[m]).join(", ") : "filters"}</p>
      </Link>
    </li>
  );
}
