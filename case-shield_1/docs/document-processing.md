# Case Shield — Document Processing Pipeline (Phase 4)

This document describes how an uploaded document version becomes searchable,
classified, and summarized. It covers what the pipeline guarantees and where it
stops. See also `docs/ai-architecture.md` (providers, guardrails) and
`docs/search-architecture.md` (indexing and authorization-aware retrieval).

## 1. Principles

- **Originals are never modified.** The stored object is only *read*. Every
  output is a derived row in `document_intelligence`, keyed to one immutable
  `document_versions` row.
- **Integrity first.** Before any byte is used, the pipeline recomputes the
  SHA-256 of the stored object. It refuses to process a file that no longer
  matches its registered hash. It records an `INTEGRITY_VIOLATION` audit event
  and a CRITICAL security event.
- **Only masked text leaves the extractor.** Extracted and OCR text is run
  through PII detection and masking (`privacy/pii`) *before* it is stored,
  indexed, used for snippets, or sent to any AI provider.
- **RESTRICTED material stays out of OCR and AI.** Its text layer, if any, is
  still extracted, masked and indexed so authorized users can keyword-search
  it. OCR, classification, metadata extraction and summaries are `SKIPPED`,
  and the reason is recorded.
- **Honest status.** Each step records its own status and a safe, content-free
  reason. A failed step does not hide the others. The overall status is
  `PARTIAL` when any step failed. The pipeline never records an "empty
  success".
- **Upload never waits.** Upload persists a `QUEUED` row and job inside the
  upload transaction. It enqueues work only after the transaction commits.

## 2. Flow

```
upload / new version ──(same DB transaction)──▶ DocumentIntelligence QUEUED
                                                AiProcessingJob PROCESS_DOCUMENT QUEUED
                                                audit AI_PROCESSING_QUEUED
          │ commit
          ▼
ProcessingQueue.enqueue({ intelligenceId, jobId, requestId })   ← ids only, never content
          ▼
runDocumentPipeline
  1. verify SHA-256 of stored bytes            (refuse on mismatch)
  2. text layer (pdf.js / UTF-8)  ──no text──▶ OCR provider (images, scanned PDFs)
  3. PII detection → masked text               (counts stored, values never)
  4. classification  (AI suggestion)
  5. metadata extraction (AI suggestion, unknown = null)
  6. summary (guardrails + re-masking)
  7. search index (PostgreSQL trigger rebuilds searchVector)
          ▼
processingStatus COMPLETED | PARTIAL | FAILED, audit AI_PROCESSING_COMPLETED / _FAILED
```

Code: `backend/src/modules/ai/processing/document-pipeline.ts` (steps),
`processing-queue.ts` (queue), `ai/intelligence/intelligence.service.ts`
(queueing, API, review).

## 3. Text extraction vs. OCR

| Input | Path | `extractionStatus` |
| --- | --- | --- |
| `text/plain`, PDF with a text layer | built-in text-layer extractor | `TEXT_EXTRACTED` |
| PDF without a text layer, PNG, JPEG, TIFF | OCR provider | `OCR_PROCESSED` / `PARTIAL` / `FAILED` |
| image/scanned PDF marked RESTRICTED | none (policy) | `SKIPPED` |
| audio, video, Office documents | none | `UNSUPPORTED` |
| unreadable / encrypted PDF | none | `FAILED` |

If a PDF has a text layer and also embedded images, the limitations note says
that text inside the images was not OCR-processed.

OCR results carry per-page text, mean confidence, detected language, and
limitations. The pipeline reports `PARTIAL` when some pages returned no text or
when any page's confidence is below 0.5.

## 4. OCR providers

Selected by `OCR_PROVIDER`. When it is unset, the choice follows `AI_PROVIDER`
(`mock` → mock OCR, otherwise Document AI).

- **`MockOCRProvider` (development).** It performs no pixel recognition. It
  reads an explicit *fixture layer* that demo and test files carry:
  - a PNG `tEXt` chunk,
  - a JPEG `COM` segment,
  - a PDF Info-dictionary entry.

  All three use the key `CaseShieldOCR` (builders in
  `prisma/fixtures/ocr-fixtures.ts`). Every result is labeled as coming from a
  fixture layer. Any other image returns `FAILED` with an explicit reason.
- **`DocumentAIOCRProvider` (production).** Google Document AI's online
  `:process` call, with base64 content and credentials from Application Default
  Credentials. Inline payloads are limited to 20 MB, and the processor's page
  cap applies. Larger files return `UNSUPPORTED`; batch processing through GCS
  is future work. Request shaping and response parsing are unit-tested with an
  injected transport. The adapter has **not** been exercised against a live
  project.

## 5. Queue and worker

`ProcessingQueue` is the seam for asynchronous work. The current
implementation is an **in-process serial worker**:

- `DOCUMENT_PROCESSING_MODE=auto` (default) runs jobs in the background right
  after enqueue.
- `manual` queues them until `drain()` is called. The test suite uses this so
  that the tests are deterministic.
- At startup (auto mode) the server re-enqueues jobs left `QUEUED` or
  `PROCESSING` by a restart. The in-process queue itself is not durable.

The production path is: Cloud Storage finalize event or API publish → Pub/Sub →
Cloud Run worker invoking the same `runDocumentPipeline(message)`. The message
format (`intelligenceId`, `jobId`, `requestId`) is already transport-neutral.
This is **not implemented yet**.

## 6. Reprocessing and versions

- `POST /api/documents/:id/intelligence/reprocess` (`ai.process`) queues a new
  attempt for the current version. It returns `409` while a job is queued or
  running.
- Reprocessing regenerates the AI suggestions. It keeps human review decisions
  (confirmed type, confirmed metadata), and confirmed metadata keeps driving
  the index.
- Each new version gets its own intelligence row. Earlier versions' rows are
  kept.

## 7. What is stored

`document_intelligence` stores:

- statuses, providers and timestamps;
- PII-masked text (capped at 200,000 characters);
- PII counts by type (values are never stored);
- the AI suggestions with their confidence;
- review decisions with reviewer and time;
- a trigger-maintained `searchVector`.

The API returns only a 4,000-character masked preview of the text.

Audit events: `AI_PROCESSING_QUEUED`, `AI_PROCESSING_STARTED`, `OCR_STARTED`,
`OCR_COMPLETED`, `OCR_FAILED`, `DOCUMENT_CLASSIFIED`,
`DOCUMENT_METADATA_EXTRACTED`, `DOCUMENT_SUMMARY_GENERATED`,
`AI_PROCESSING_COMPLETED`, `AI_PROCESSING_FAILED`,
`AI_CLASSIFICATION_REVIEWED`, `AI_METADATA_REVIEWED`,
`DOCUMENT_INTELLIGENCE_VIEWED` (denials), and `DOCUMENT_SEARCH_PERFORMED`.
Audit rows hold ids, statuses, counts, providers and field names. They never
hold document text, corrected values, or search query text.

## 8. Limitations

- The mock OCR provider does not recognize pixels. Real OCR requires
  `OCR_PROVIDER=document-ai` with a configured processor.
- Online Document AI only (≤20 MB); no batch OCR, no handwriting-specific
  tuning, no layout or table extraction.
- The in-process queue is single-worker and not durable. Throughput is bounded
  by one Node process.
- Office documents, audio and video are not text-extracted.
- PII detection is rule-based (see `docs/security-architecture.md` §21). Any
  PII it misses would remain in the derived text.
