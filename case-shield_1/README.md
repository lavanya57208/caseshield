# Case Shield

**Secure Digital Legal & Investigation Document Management System**

Case Shield is a case- and document-management prototype for sensitive legal
and investigation records — FIRs, investigation reports, witness statements,
charge sheets, court filings, evidence, and forensic reports — built for a
Smart India Hackathon submission. It is architected as production-oriented
and cloud-ready software, not a classroom CRUD demo: fine-grained
authorization, SHA-256 document integrity, evidence chain-of-custody, and a
tamper-evident audit trail are enforced end-to-end, not just shown in the UI.

> **Prototype disclaimer.** Case Shield is not an official Government of
> India system, is not independently security-assessed, and makes no
> compliance or admissibility claims. See "Important Limitations" below and
> `docs/security-architecture.md`.

## Problem & Solution

Investigation and legal teams routinely lose time and security to
fragmented document storage, unclear access control, undetected tampering,
weak audit trails, and ad hoc evidence handling. Case Shield addresses this
with a single system of record built around a case workspace: every
document and evidence item belongs to a case, every access decision is
evaluated server-side against a Person → Role → Organization → Case →
Document → Permission → Action model, every document version carries a
SHA-256 hash that can be re-verified on demand, and every sensitive action
is written to an append-only audit trail. Full detail: `docs/product-requirements.md`.

## Features

- Role-aware dashboard, case management with a configurable classification
  hierarchy, and a Case Workspace (Overview, Documents, Evidence, Audit
  Trail, Access Requests, Activity) with a per-item Evidence Detail page.
- Document upload with server-side MIME/size/signature validation, real
  SHA-256 hashing, append-only versioning, and one-click integrity
  verification (`VERIFIED` / `VIOLATION`).
- **Phase 3 — Evidence & chain of custody:** case-scoped evidence registry
  (digital evidence references an immutable document version, never a
  copy); server-enforced lifecycle; custody transfer with explicit
  recipient receipt; a hash-linked, tamper-evident custody timeline with
  chain verification; SHA-256 evidence integrity verification; evidence
  access logging; and a case-scoped, filterable audit trail. See
  `docs/security-architecture.md` §22–§26.
- Access-request workflow (request → approve/reject → audit → active grant)
  with case- and document-level permission overrides.
- **Phase 2 — PII protection & controlled sharing:** deterministic PII
  scanning (Aadhaar-like numbers, Indian mobile numbers, emails, IPv4,
  limited address-like heuristics) with masked review; safe PDF/text
  redaction into a separate derivative (reconstruction, never overlay-only)
  with post-redaction verification; dynamic per-recipient watermarking; and
  purpose-bound, time-limited, approval-aware secure sharing with
  server-enforced expiry, revocation and download control. Originals are
  never modified. See `docs/security-architecture.md` §17–§21.
- Append-only audit trail and an application-level Security Center.
- Authorization-aware search that never reveals a resource the caller
  cannot access.
- **Phase 4 — Document intelligence & search:**
  - Every upload or new version is queued asynchronously through an
    integrity-checked pipeline: text-layer extraction or OCR (Google Document
    AI in production, a fixture-reading mock in development), PII masking, AI
    classification into a legal document taxonomy, structured metadata
    extraction (unknown values stay blank), and a guardrailed summary.
  - Every suggestion shows its confidence and provenance. An authorized user
    can confirm, correct, or reject it.
  - Authorization-aware full-text search uses a PostgreSQL `tsvector` over
    PII-masked text and metadata. An AI-assisted "intelligent" mode adds query
    interpretation and embedding re-ranking.
  - RESTRICTED material never reaches OCR or AI providers.
  - See `docs/document-processing.md`, `docs/ai-architecture.md` and
    `docs/search-architecture.md`.

## Architecture

Modular monolith: one frontend, one backend organized into domain modules
(`auth`, `cases`, `documents`, `evidence`, `custody`, `access`, `audit`,
`notifications`, `search`, `ai`, `security`, `storage`), one PostgreSQL
database (metadata only — binaries live in object storage), one audit
system. Business logic depends only on provider **interfaces**
(`StorageProvider`, `IdentityProvider`, `KeyManagementProvider`,
`AIProvider`, `NotificationProvider`); development and production
implementations are swapped by a factory keyed on `CASE_SHIELD_ENV`, with
no business-logic changes required. Full detail, diagrams, and data flows:
`docs/architecture.md`. Threat model and controls: `docs/security-architecture.md`.
Schema: `docs/database.md`. Endpoints: `docs/api.md`.

## Technology Stack

**Frontend:** React, TypeScript, Vite, Tailwind CSS, React Router, TanStack
Query, React Hook Form, Zod, Lucide icons.

**Backend:** Node.js, TypeScript, Express, Zod, PostgreSQL, Prisma ORM.

**Reference cloud (production):** Google Cloud Storage, Cloud SQL for
PostgreSQL, Identity Platform, Cloud KMS / Cloud HSM, Secret Manager, Cloud
Run/GKE, Cloud Load Balancing, Cloud Armor, Cloud Logging, Pub/Sub.

**Security:** HTTPS/TLS in production, MFA-ready auth, RBAC + case/document
ABAC, Helmet security headers, rate limiting, Zod input validation, file
signature checks + malware-scan integration point, structured logging,
SHA-256 integrity verification.

## Project Structure

```
case-shield/
  frontend/           React + TypeScript + Vite app
  backend/             Node.js + TypeScript + Express modular monolith
    src/modules/        auth, users, organizations, cases, documents,
                         evidence, custody, access, audit, notifications,
                         search, ai, security, storage
  prisma/              schema.prisma, seed.ts
  docs/                product-requirements, architecture, security,
                         database, api
  tests/backend/       vitest unit tests
  .env.example
```

## Local Development

### Prerequisites

- Node.js 20+
- PostgreSQL 16 (a local server is simplest; Docker works too)

### 1. Install dependencies

```bash
npm install
```

> **A note on this repository's origin.** This codebase was generated in a
> sandboxed environment whose outbound network access was restricted to an
> organization egress allowlist that did **not** include `registry.npmjs.org`
> or `pypi.org` (`npm install` there failed with `host_not_allowed`), so
> `npm install` could not be executed or verified end-to-end inside that
> sandbox. Every source file was reviewed with the TypeScript compiler in
> syntax-check mode (all reported errors were traced to missing
> `node_modules`, none were real syntax errors) and the Prisma schema was
> validated by hand against every module's Prisma calls. Running the steps
> below on a machine with normal network access is expected to work; please
> open an issue (or just fix it forward) if something doesn't.

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` if your local PostgreSQL differs from the default
(`postgresql://caseshield:caseshield_dev_pw@localhost:5432/case_shield_dev`).
Set `JWT_SECRET` to any long random string for local development.

Create the local database and role (adjust to your Postgres setup):

```bash
sudo -u postgres psql -c "CREATE USER caseshield WITH PASSWORD 'caseshield_dev_pw' CREATEDB;"
sudo -u postgres psql -c "CREATE DATABASE case_shield_dev OWNER caseshield;"
```

### 3. Database setup

```bash
npm run prisma:generate
npm run prisma:migrate    # creates and applies the initial migration
npm run prisma:seed       # loads fictional demo data — see below
```

### 4. Run the app

```bash
npm run dev:backend    # http://localhost:4000
npm run dev:frontend   # http://localhost:5173 (proxies /api to the backend)
```

Open `http://localhost:5173` and sign in with a demo account below.

### Environment variables

See `.env.example` for the full list. `CASE_SHIELD_ENV=development` (the
default) selects local adapters: filesystem storage under
`backend/storage-dev/`, the seeded demo identity provider, a local
in-memory key provider, and the mock AI provider. Setting
`CASE_SHIELD_ENV=production` switches to the Google Cloud adapters, which
require every `GOOGLE_CLOUD_*` / `IDENTITY_PLATFORM_*` value to be
populated and have not been exercised against live GCP credentials in this
project's development environment (see "Important Limitations").

## Testing

```bash
npm run test:backend
```

Backend tests (`tests/backend/`) cover: SHA-256 hashing correctness and
tamper detection, the core authorization model (`can()` /
`hasCaseAccess()` — cross-organization denial, missing-assignment denial,
case- and document-level grant overrides, RESTRICTED-classification
enforcement), server-side file validation (MIME/size/magic-byte checks),
and the permission catalog's internal consistency (e.g. `document.delete`
is deliberately granted to no role). Authorization tests mock Prisma so
they run without a live database.

Phase 2 adds:

- Unit tests for PII detection and masking, the share access policy,
  PDF/text redaction and watermarking, and audit sanitization.
- **Integration tests** (`tests/backend/integration/`) that drive the real
  Express app against an isolated PostgreSQL database. They cover scanning,
  redaction, watermarking, authorized and unauthorized sharing, approval
  and separation of duties, view-only download control, revoked, expired
  and not-yet-started shares, and the absence of raw PII in audit rows.

Phase 3 adds:

- Unit tests for the custody hash chain (hashing, linkage, edit /
  deletion / truncation detection), the evidence lifecycle state machine,
  the evidence policy (visibility, allowed actions, transfer validation)
  and evidence confidentiality in `can()`.
- `tests/backend/integration/phase3-evidence.integration.test.ts`:
  registration, access control, transfer / accept / reject, custodian-only
  actions, invalid transitions, integrity verification and tamper
  detection, custody-chain verification and broken-chain detection, and
  scoped audit filtering.

Phase 4 adds:

- `tests/backend/phase4-intelligence.test.ts`:
  - classification and metadata heuristics (missing values stay null);
  - summary guardrails and query interpretation;
  - mock OCR over PNG, JPEG, and image-only PDF fixtures (COMPLETED, PARTIAL,
    FAILED, UNSUPPORTED);
  - the Document AI and Vertex AI adapters with an injected transport
    (request shape, response validation, anti-fabrication);
  - embeddings.
- `tests/backend/integration/phase4-intelligence.integration.test.ts`:
  - upload → queue → pipeline for text, scanned PNG, and scanned PDF;
  - honest failure for unreadable scans, and the RESTRICTED policy;
  - no raw PII in stored text, API responses, snippets, or audit rows;
  - intelligence API authorization;
  - search that never returns or counts unauthorized documents (same-org
    outsider, cross-org admin, RESTRICTED without a grant), plus filters and
    intelligent search;
  - human review: confirm, correct, apply a type, and a metadata correction
    becoming searchable;
  - reprocessing that preserves review, new versions, and tamper refusal.

Integration files run sequentially (`fileParallelism: false`) because they
share one test database.

The test database is `TEST_DATABASE_URL`, or `DATABASE_URL` with `_test`
appended to the database name. `tests/backend/setup/global-setup.ts`
creates it (the DB role needs `CREATEDB`), migrates it, and truncates it
before each run. It refuses to touch any database whose name does not end
in `_test`.

## Demo Accounts

Development-only, fictional identities (seeded by `npm run prisma:seed`).
Password for every account: **`CaseShield#2026`**

| Role | Email |
|---|---|
| Investigator | investigator@caseshield.local |
| Senior Investigator | senior@caseshield.local |
| Forensic Officer | forensic@caseshield.local |
| Prosecutor | prosecutor@caseshield.local |
| Judge | judge@caseshield.local |
| Lawyer | lawyer@caseshield.local |
| Court Staff | courtstaff@caseshield.local |
| Auditor | auditor@caseshield.local |
| Administrator | admin@caseshield.local |

The login page also lists these accounts with one-click autofill.

## Demo Flow

Log in as Investigator → Dashboard → open `CASE-2026-00427` → Documents tab
→ upload `Forensic_Report.pdf` (SHA-256 computed, `DOC-2026-00xxxx`
registered, integrity `VERIFIED`) → Evidence tab → open `EVD-2026-00041`
to see its chain of custody (see the Phase 3 flow below) → sign out, sign in as Prosecutor
→ request access to a restricted document → sign in as Senior Investigator
→ approve the request → Audit Trail tab confirms every step → Search →
AI-assisted metadata extraction on a document → Audit & Security Center.

**Phase 2 flow:** as Investigator, open `DOC-2026-001844`
(`Complainant_Contact_Sheet.pdf`, a real PDF containing only fictional
PII) and use the **Document security** panel:

1. **Scan for PII**, then review the masked findings.
2. **Redact selected**. This creates a redacted derivative; the original's
   hash is unchanged.
3. Optionally create a **Watermarked copy**.

As Senior Investigator, choose **Share securely** to the Prosecutor with
purpose *Court Filing*, an expiration date, redaction, watermark, and
download on or off. Then:

- As Administrator, approve the share under **Secure Shares →
  Pending approvals**.
- As Prosecutor, open **Secure Shares → Shared with me** to view or
  download the watermarked, redacted copy. Download is disabled and
  rejected by the API for view-only shares.
- Revoke the share, or let it expire; access is then refused server-side.
- Each step appears in the document's audit trail.

**Phase 3 flow (evidence & chain of custody):**

1. As **Forensic Officer**, open `CASE-2026-00427` → **Evidence**. The
   banner shows `EVD-2026-00043` awaiting your receipt → **Review** →
   **Accept evidence**. Custody moves to you only now.
2. Open `EVD-2026-00041` → **Verify evidence** (`INTEGRITY VERIFIED`) and
   **Verify custody chain** (`CUSTODY CHAIN VERIFIED`).
3. As **Investigator**, **Register evidence** (optionally attach a case
   document; its SHA-256 is recalculated from storage) → **Transfer** to
   the Forensic Officer with a reason → status *Pending Receipt*.
4. As **Forensic Officer**, accept from **Notifications → Review**, then
   **Record examination**.
5. As **Senior Investigator**, open **Audit** and filter by evidence,
   actor, action, result or date. Only cases you may audit are listed.
6. As **Judge**, the evidence list is empty until an item is submitted to
   court; as **Lawyer**, evidence is refused.

**Phase 4 flow (document intelligence & search):**

1. Start the API with `DOCUMENT_PROCESSING_MODE=auto` (the default). The seed
   queues the seeded documents, and the API processes them on startup.
2. As **Investigator**, open `DOC-2026-001845` (`FIR_scan.png`, an image with
   no text layer). The **Document intelligence** panel shows:
   - *OCR processed* (mock OCR, labeled as a fixture layer);
   - the AI-suggested type *FIR*;
   - the extracted metadata with confidence;
   - a summary.

   The complainant's email is masked in the extracted text.
3. **Confirm** or **Correct** the classification (optionally recording it as
   the document's type), and **Edit** a metadata field. Provenance changes to
   *Human confirmed* or *AI assisted*.
4. Upload a new PDF or image in the case's Documents tab. Its status moves
   from *Queued* to *Processing* to *Completed* without blocking the upload.
5. In **Search → Documents**, search `stolen two-wheeler` (keyword mode, with
   highlighted masked snippets). Then switch to **Intelligent** and ask
   `FIR about theft in CASE-2026-00427`. The interpretation chips show which
   filters were applied.
6. Sign in as a user without access to the case. The same searches return
   nothing, with a total of 0.

A controlled integrity-mismatch fixture (a deliberately mismatched hash on
a second version of the seeded forensic report) is included so the
Integrity Verification "VIOLATION" state can be demonstrated without
damaging real evidence data.

## Deployment

Reference production architecture: Cloud Load Balancing → Cloud Armor →
Cloud Run/GKE (frontend + backend) → Cloud SQL (PostgreSQL) + Cloud Storage
+ Cloud KMS, with Pub/Sub for async work (AI processing, notification
fan-out) and Cloud Logging/Audit Logs throughout. See
`docs/architecture.md` §9 for the diagram and `infrastructure/` for
deployment notes. The application is not hardcoded to Google Cloud at the
business-logic level — only the adapter implementations are — so it can in
principle be redeployed into another approved cloud or government/public-
sector environment, subject to that environment's own procurement and
security requirements.

## Security Notes

Read `docs/security-architecture.md` for the full threat model and control
list. Highlights: the backend never trusts a client-supplied role, user ID,
case ID, or document ID — every request re-derives identity from a
verified session and re-checks authorization against the database;
document/evidence binaries never touch PostgreSQL; secrets come from
environment variables in development and Secret Manager in production,
never from source code or the frontend bundle; SHA-256 integrity, digital
signatures, and encryption are treated as three distinct properties and
never conflated in the UI or docs.

## Important Limitations

- This is a hackathon prototype. It has not undergone independent security
  assessment, penetration testing, or formal threat-model review.
- `npm install` was not executed in the environment that generated this
  repository (see "Local Development" §1) — please run the standard setup
  on a machine with normal network access and report anything that doesn't
  work.
- Google Cloud production adapters (`GoogleCloudStorageProvider`,
  `GoogleIdentityPlatformProvider`, `GoogleCloudKMSProvider`,
  `VertexAIProvider`, `ProductionNotificationProvider`) are implemented
  against the documented APIs but have not been exercised against live GCP
  credentials.
- Malware scanning is mocked; MFA is structurally present but not enforced
  by default; digital signatures are modeled but not cryptographically
  applied — see `docs/security-architecture.md` §16 for the complete list.
- PII detection is rule-based and not exhaustive (address detection is a
  limited heuristic). PDF redaction reconstructs the text layer
  (approximate layout, images omitted). Watermarks deter and attribute but
  are not DRM. See `docs/security-architecture.md` §21.
- Phase 4 limitations (see `docs/document-processing.md` §8 and
  `docs/search-architecture.md` §6):
  - The development OCR provider does **not** recognize pixels. It reads an
    explicit fixture layer embedded in demo and test files, and reports
    `FAILED` for any other image. Real OCR requires
    `OCR_PROVIDER=document-ai`.
  - The development AI provider is a transparent heuristic, not a language
    model, and its embeddings are lexical.
  - `DocumentAIOCRProvider`, `VertexAIProvider` and `VertexEmbeddingProvider`
    are unit-tested with an injected transport but have not been run against
    live Google Cloud.
  - The processing queue is in-process: a single worker, not durable across
    restarts except that queued jobs are re-enqueued at startup. Pub/Sub and
    Cloud Run workers are future work.
  - Search uses PostgreSQL full-text search with English stemming, and there
    is no persistent vector index.
- The custody chain is hash-linked and tamper-*evident* inside the
  application database. It is not a blockchain, not tamper-proof, and
  cannot detect a consistent rewrite of an entire chain by someone with
  direct database access. Hyperledger Fabric anchoring is **future work
  and not implemented** — see `docs/security-architecture.md` §23 and §26.
- Case Shield makes no claim of official Government of India status,
  endorsement, or integration, and no claim of guaranteed legal
  admissibility — see `docs/security-architecture.md` §15 for the language
  policy this project follows.

## Roadmap

Optional Hyperledger Fabric adapter that anchors custody chain heads and
document hashes (never document content); real Google Cloud integration
and a staging deployment; enforced MFA;
cryptographically valid digital signatures via an approved PKI/CA
integration; Pub/Sub-driven document-processing workers and batch
Document AI OCR; a persistent vector index (pgvector / Vertex AI Vector
Search) behind the existing authorization filter; approved
malware-scanning integration; expanded automated test coverage (frontend
component tests, end-to-end flows, load testing); formal security
assessment ahead of any real deployment.

---

Generated with [Claude Code](https://claude.com/claude-code).
