# Case Shield — Search Architecture (Phase 4)

`GET /api/search/documents` searches inside documents. It covers extracted and
OCR text (PII-masked), AI-extracted metadata, titles, numbers, and tags, with an
optional AI-assisted "intelligent" mode. The pre-existing `GET /api/search`
(title search across cases, documents, and evidence) is unchanged.

## 1. Authorization before ranking

Search never ranks, counts, snippets, or embeds a document the caller cannot
view. The order is fixed (`search/document-search.service.ts`):

1. **Candidate set (superset).** The service collects documents in cases the
   caller could possibly see: same organization, plus investigating officer,
   assignment, an active unexpired case grant, or an oversight role (ADMIN,
   AUDITOR, JUDGE).
2. **Exact decision.** `authorizeDocuments(user, ["document.view"], docs)` is
   the batched form of `can()`. Both share one pure rule (`decidePermission`),
   so single-item and bulk authorization cannot disagree. This step enforces
   the RESTRICTED / HIGHLY_CONFIDENTIAL explicit-grant rule and document-level
   grants.
3. **Rank the authorized set only.** Full-text matching runs as SQL restricted
   to the authorized version IDs. Title, number, and tag matching and semantic
   scoring operate on the same in-memory authorized list.

As a result, `total`, `results`, snippets, and interpretation chips reflect
only authorized documents. A user without access cannot tell whether a
matching document exists (integration-tested with same-organization outsiders
and cross-organization admins).

## 2. Index

- `document_intelligence."searchVector"` is a `tsvector` maintained by a
  PostgreSQL trigger:
  - weight **A**: `metadataText` (extracted or confirmed metadata values plus
    the classification);
  - weight **B**: `maskedText`.
- A GIN index backs the full-text search.
- Only masked text is indexed. A raw PII value (for example, a phone number)
  cannot be used to find a document, and a snippet cannot display one.
- The index is rebuilt when the pipeline writes text or metadata, and when a
  human confirms, corrects, or rejects metadata. Rejected metadata stops
  contributing.

## 3. Keyword mode

- The query goes to `websearch_to_tsquery('english', q)`, which supports quoted
  phrases, `or`, and `-exclusion`.
- Score = normalized `ts_rank_cd`, plus boosts for title, document or case
  number, and tag matches.
- Snippets come from `ts_headline` over masked text, with matches wrapped in
  `[[…]]`. The UI renders the markers as `<mark>` elements from plain text,
  never as HTML.
- Filters: `caseId`, `documentType`, `dateFrom`, `dateTo`.
  - `documentType` matches the document's recorded type, its human-confirmed
    type, or its AI-suggested type.
  - Dates use the extracted document date when one is known, otherwise the
    upload date.

## 4. Intelligent mode

1. **Query interpretation.** The masked query goes to
   `AIProvider.interpretSearchQuery`, which returns keywords, document types,
   `CASE-…` and `EVD-…` numbers, and a date range. Vertex output is validated:
   case and evidence numbers must appear in the query, and types must be in the
   taxonomy. On failure, the heuristic interpreter is used and the response
   sets `interpretation.fallback: true`.
2. **Filters narrow, never widen.** Interpreted filters are added to the
   candidate query. Authorization (step 2 above) still applies afterwards.
3. **Semantic re-ranking.**
   - Pool: the top 200 authorized, **non-RESTRICTED** candidates.
   - Embedded text: title, summary, and metadata (masked).
   - Score: cosine similarity to the query embedding, weighted 0.7 and added
     when above 0.15.
4. The response explains itself: `interpretation`, `ranking.semanticProvider`
   or `semanticError`, and per-hit `matchedOn`
   (`title`, `number`, `tags`, `metadata`, `text`, `semantic`).

## 5. Auditing

Each document search writes `DOCUMENT_SEARCH_PERFORMED` with the mode, query
*length*, result count, filters, and whether semantic ranking ran. The query
text itself is **not** stored, because free-text queries often contain names.

## 6. Limits and future work

- Candidate cap: 2,000 most recent documents per search in the caller's
  visible cases. Beyond that, results are truncated to recent documents. A
  production deployment at larger scale should push the authorization
  predicate into SQL or into a dedicated engine's document-level security
  filter.
- There is no persistent vector store. The seam for one is
  `EmbeddingProvider`: a pgvector column per version, or Vertex AI Vector
  Search, with the authorization filter still applied first.
- English stemming only (`'english'` configuration). Hindi and other Indian
  languages need language-aware configurations.
- The candidate query loads metadata for every candidate, which is adequate
  for prototype-scale data.
