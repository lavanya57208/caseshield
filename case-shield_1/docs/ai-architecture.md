# Case Shield — AI Architecture (Phase 4)

AI in Case Shield is **assistive**. It suggests a document type, pulls out
metadata, and drafts a summary. It never decides anything, never bypasses
authorization, and never edits originals. See `docs/document-processing.md` for
the pipeline and `docs/search-architecture.md` for search.

## 1. Provider interfaces

| Interface | Development adapter | Production adapter |
| --- | --- | --- |
| `AIProvider` (`ai/ai-provider.types.ts`) | `MockAIProvider`: deterministic keyword and pattern heuristics (`ai/heuristics.ts`) | `VertexAIProvider`: Gemini `generateContent` in JSON mode |
| `OCRProvider` (`ai/ocr/ocr-provider.types.ts`) | `MockOCRProvider`: reads embedded fixture layers | `DocumentAIOCRProvider`: Document AI `:process` |
| `EmbeddingProvider` (`ai/embeddings`) | `MockEmbeddingProvider`: feature hashing (lexical, not truly semantic) | `VertexEmbeddingProvider`: text embeddings `:predict` |

Selection:

- `AI_PROVIDER=mock|vertex|document-ai` selects the AI and embedding
  providers.
- `OCR_PROVIDER=mock|document-ai` selects OCR. When unset, it follows
  `AI_PROVIDER`.

The Google adapters share one authenticated transport
(`ai/google-rest.ts`, Application Default Credentials). That transport never
includes response bodies in errors, because they can echo document content.

**Status:** the Google adapters are implemented against the documented REST
APIs and unit-tested with an injected transport. They have **not** been run
against a live Google Cloud project.

## 2. What a provider may receive

The calling service enforces all of the following *before* any provider call:

1. **Authorization.** The caller uses the same `can()` check as the rest of the
   API (`ai.process` to run or review; `document.view` to read). The worker
   runs only jobs created through an authorized upload or reprocess.
2. **Policy.** `RESTRICTED` documents are never sent to OCR, AI, or embedding
   providers.
3. **Masking.** Providers receive only PII-masked text (`maskPiiInText`),
   truncated to 30,000 characters. Search-query interpretation receives only
   the masked query, never any documents.

## 3. Output handling

- **Taxonomy.** The classification must be one of
  `DOCUMENT_CLASSIFICATION_TYPES`. Anything else becomes `OTHER` (Vertex caps
  its confidence at 0.5).
- **No fabrication.** Metadata fields that are not clearly present are
  `{ value: null, confidence: 0 }`. For Vertex output, identifier-like values
  (case number, author, department, evidence IDs, party names) are dropped
  unless they occur verbatim in the source text.
- **Summary guardrails** (`ai/guardrails.ts`). A sentence asserting guilt,
  innocence, liability, sentencing, or legal advice is removed unless it
  quotes the source verbatim (for example, a judgment's own words). The
  summary is PII-masked again before it is stored.
- **Determinism.** Vertex uses `temperature: 0` and a system instruction that
  forbids inference beyond the text and forbids legal conclusions. The mock is
  fully deterministic.
- **Confidence** values are heuristic or model-reported scores. They are not
  calibrated probabilities.

## 4. Provenance and human review

Every AI field is stored as a suggestion with a provenance label:

- `AI_GENERATED`: unreviewed provider output.
- `HUMAN_CONFIRMED`: an authorized user accepted it unchanged.
- `AI_ASSISTED`: an authorized user corrected it. The original suggestion is
  kept alongside.

Review endpoints (`ai.process`) record the reviewer, the time, and an audit
event. Classification review can optionally write the confirmed type to the
document's own `type` field. That write additionally requires
`document.version`, and the audit event records the previous type. AI never
writes to the document record on its own.

The UI labels every AI output. It shows confidence, provenance, and the review
state, and it carries the disclaimer: *"AI-generated, non-authoritative. Based
only on the document's extracted text. Not legal advice and not a legal
determination."*

## 5. Failure behavior

Each AI step fails independently: it is marked `FAILED` with
`AI provider error: …` and the overall status becomes `PARTIAL`. Intelligent
search falls back to the heuristic query interpreter when the AI interpreter
fails, and to keyword ranking when embeddings fail. The response says so in
both cases.

## 6. Limitations

- The mock provider is a transparent heuristic. It suits demos and
  reproducible tests; it is not a language model.
- Mock embeddings are lexical (feature hashing). Real semantic similarity
  requires `VertexEmbeddingProvider`.
- No persistent vector index. Embeddings are computed per query over at most
  200 already-authorized candidates.
- No fine-tuning or evaluation dataset. Classification quality on real legal
  documents is unmeasured.
