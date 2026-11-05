# Case Shield — API Documentation

Base path: `/api`. All responses are JSON. All protected routes require
`Authorization: Bearer <token>` (or the session cookie in browser
contexts). Every protected route enforces authentication, then
authorization (RBAC + case/document-level ABAC), then input validation, in
that order — see `docs/architecture.md` §4.

## Error Shape

```json
{
  "error": {
    "code": "DOCUMENT_ACCESS_DENIED",
    "message": "You do not have permission to access this document.",
    "requestId": "a1b2c3d4-..."
  }
}
```

Stack traces and internal details are never returned to the client; they
are written to server-side structured logs keyed by `requestId`.

## Auth — `/api/auth`

- `POST /login` — `{ email, password }` → `{ user, token }`. Demo mode
  accepts the seeded accounts in `docs/README` §Demo Accounts.
- `POST /logout` — revokes the current session.
- `GET /me` — returns the authenticated user, roles, and effective
  permission summary.
- `POST /mfa/verify` — MFA-ready stub for a second factor.

## Users — `/api/users`

- `GET /` — list users (admin only).
- `GET /:id` — user detail.
- `PATCH /:id` — update profile/role assignments (admin, audited).

## Cases — `/api/cases`

- `GET /` — list cases, filterable by status/category/type/priority/court/
  assignment, paginated. Returns only cases the caller can see.
- `POST /` — create case (`case.create`). Optional `caseNumber`
  (`CASE-YYYY-NNNNN`); when omitted the next free number is assigned. A
  number already in use returns `409 CASE_NUMBER_TAKEN`. `typeId` must belong
  to `categoryId` (`400 INVALID_CASE_TYPE`). `investigatingOfficerId` must be
  an active investigator in the caller's organization (`400 INVALID_OFFICER`).
  A creator who names someone else as officer is added to the team as
  `SUPERVISING_OFFICER`, so they keep access.
- `GET /next-number` — suggested next case number (`case.create`). It is not
  reserved.
- `GET /officers` — assignable investigating officers (`case.create`); returns
  `id`, `fullName`, `department` and `role` only.
- `GET /:id` — case detail incl. summary stats (`case.view`, case-scoped).
- `PATCH /:id` — update title, category/type (`typeId` is required when the
  category changes), status, priority, confidentiality, court, jurisdiction,
  description or investigating officer. Unknown fields are rejected, and the
  case number is immutable. Requires `case.update` via `can()`; denials are
  audited. The audit event records the changed field **names** only. A newly
  named officer is added to the case team.
- `POST /:id/assign` — assign a user to the case team (`case.assign`).
- `GET /:id/activity` — merged timeline of case-relevant audit events.
- `GET /categories` / `GET /types` — classification hierarchy.

## Documents — `/api/documents`

- `GET /?caseId=` — list documents for a case (`document.view`).
- `POST /` — multipart upload (`document.upload`); runs the flow in
  `docs/architecture.md` §10 and returns the created document + v1.
- `GET /:id` — metadata, current version, permissions, access history.
- `GET /:id/versions` — full version history (`document.version`).
- `POST /:id/versions` — upload a new version with a change note.
- `GET /:id/download` — streams the file if `document.download` is
  granted; else `403 DOCUMENT_ACCESS_DENIED`.
- `POST /:id/verify` — recompute hash of the current (or a specified)
  version and compare to the registered hash (`document.verify`). Returns
  `{ status: "VERIFIED" | "VIOLATION", registeredHash, currentHash }`.
- `POST /:id/ai/extract` — routes to `AIService.extractMetadata` after the
  authorization + classification checks in
  `docs/security-architecture.md` §11.

## Evidence — `/api/evidence` (Phase 3)

All routes require authentication; authorization (case access,
classification, custody, lifecycle) is decided server-side. Every evidence
object includes `allowedActions` computed for the caller. The Phase 1
`POST /:id/custody` (free-form action) has been **removed**.

| Method & path | Purpose | Notes |
|---|---|---|
| `GET /?caseId=&status=&type=&q=&page=&pageSize=` | List case evidence | `evidence.view`; Judges only see submitted items (`courtOnly: true`) |
| `POST /` | Register evidence | `evidence.register`. Body: `caseId, title, type, description, source?, collectedAt, collectedById?, initialCustodianId?, location?, confidentiality, notes?, documentId?, versionNumber?` |
| `GET /registration-candidates?caseId=&confidentiality=` | Eligible collectors / initial custodians | `evidence.register` |
| `GET /transfers/incoming` | Transfers awaiting the caller's receipt | |
| `GET /:id` | Detail | Audited `EVIDENCE_VIEWED`; appends a de-duplicated `VIEWED` custody entry |
| `GET /:id/custody` | Hash-linked custody timeline | Includes `sequence`, `previousEventHash`, `eventHash` |
| `GET /:id/transfer-candidates` | Eligible recipients | `evidence.transfer` |
| `POST /:id/transfers` | Initiate transfer | Current custodian only. Body `{ toUserId, reason, notes? }` → status `TRANSFERRED`, custodian unchanged |
| `POST /:id/transfers/:transferId/accept` | Receive | Named recipient + `evidence.receive`. Body `{ notes? }` |
| `POST /:id/transfers/:transferId/reject` | Reject | Named recipient. Body `{ reason }` |
| `POST /:id/transfers/:transferId/cancel` | Cancel | Initiator. Body `{ reason }` |
| `POST /:id/actions` | Lifecycle action | Body `{ action: EXAMINED\|SEALED\|UNSEALED\|SUBMITTED\|RETURNED\|ARCHIVED, reason, notes? }` |
| `POST /:id/verify-integrity` | Recompute SHA-256 of the stored bytes | `evidence.verify`; `409 NO_DIGITAL_CONTENT` for physical evidence |
| `POST /:id/verify-custody` | Verify the custody hash chain | `evidence.verify` |

Error codes: `EVIDENCE_ACCESS_DENIED` (403), `EVIDENCE_TRANSFER_DENIED`
(403), `EVIDENCE_ACTION_DENIED` (403), `INVALID_TRANSITION` (409),
`TRANSFER_NOT_PENDING` (409), `CONCURRENT_CUSTODY_UPDATE` (409),
`INTEGRITY_VIOLATION` (409, at registration), `TRANSFER_<CODE>` (400) where
`<CODE>` is `SAME_CUSTODIAN`, `RECIPIENT_INACTIVE`,
`RECIPIENT_OTHER_ORGANIZATION`, `RECIPIENT_NO_CASE_ACCESS`,
`RECIPIENT_NOT_AUTHORIZED`, `RECIPIENT_NOT_FOUND`. Cross-organization
evidence IDs return 404.

Sample `POST /:id/verify-custody` violation:

```json
{
  "status": "VIOLATION",
  "label": "CUSTODY CHAIN INTEGRITY VIOLATION",
  "eventsChecked": 4,
  "headHash": "9c1e…",
  "failures": [
    { "code": "HASH_MISMATCH", "eventId": "…", "sequence": 2,
      "expectedHash": "5b0d…", "storedHash": "e47a…",
      "message": "Custody event #2 does not match its recorded hash; its data has changed since it was recorded." }
  ],
  "message": "The custody history no longer matches its hash chain. …"
}
```

## Access Requests — `/api/access-requests`

- `GET /` — list requests visible to the caller (own requests, or all for
  an approver role).
- `POST /` — create a request (`access.request`): `{ caseId, documentId?,
  permissionKey, reason, durationDays? }`.
- `POST /:id/approve` — approve (`access.approve`); creates the
  case/document permission grant + audit event + notification.
- `POST /:id/reject` — reject with reason.
- `POST /:id/revoke` — revoke a previously granted permission
  (`access.revoke`).

## Audit — `/api/audit`

- `GET /?caseId=&evidenceId=&documentId=&actorId=&action=&result=&organizationId=&from=&to=&page=&pageSize=`
  — paginated, **case-scoped** audit search. `audit.view` is evaluated per
  case (role baseline or case grant); Admin/Auditor are organization-wide.
  A filter outside the caller's scope → `403 AUDIT_ACCESS_DENIED`
  (itself audited as `AUDIT_QUERY_DENIED`). Items include `case`,
  `evidence` and `document` reference numbers.
- `GET /facets?caseId=` — filter options (cases, evidence, actors,
  actions, organization) limited to the same scope.

Read-only; no write routes exist for this resource.

## Notifications — `/api/notifications`

- `GET /` — list for the current user.
- `POST /:id/read` — mark read.
- `POST /read-all` — mark all read.

## Search — `/api/search`

- `GET /?q=&type=case|document|evidence&filters...` — authorization-aware
  search across cases/documents/evidence. Never returns a hit for a
  resource the caller cannot view; a hit is filtered before ranking, not
  redacted after.

### Phase 4 — Document search `GET /api/search/documents`

Query parameters:

- `q`: up to 500 characters.
- `mode`: `keyword` (default) or `intelligent`.
- `caseId`, `documentType` (a classification type).
- `dateFrom`, `dateTo`: `yyyy-mm-dd`.
- `limit`: 1–50, default 20.

Either `q` or at least one filter is required. Authorization is applied
**before** ranking, so `total` counts only documents the caller may view. See
`docs/search-architecture.md`.

```json
{
  "mode": "intelligent",
  "total": 1,
  "results": [{
    "documentId": "…", "documentNumber": "DOC-2026-001845", "title": "FIR_scan.png",
    "caseId": "…", "caseNumber": "CASE-2026-00427", "type": "SUPPORTING_DOCUMENT",
    "suggestedType": "FIR", "confirmedType": null, "confidentiality": "CONFIDENTIAL",
    "processingStatus": "COMPLETED", "documentDate": "2024-03-12",
    "snippet": "…a [[two-wheeler]] was [[stolen]] from the parking area…",
    "summary": "…", "score": 1.42, "matchedOn": ["text", "semantic"]
  }],
  "interpretation": { "keywords": ["two", "wheeler", "stolen"], "documentTypes": ["FIR"], "caseNumbers": [], "evidenceNumbers": [], "fallback": false },
  "ranking": { "keyword": "…", "semanticProvider": "MockEmbeddingProvider (feature hashing, offline)", "semanticError": null },
  "tookMs": 38
}
```

## Phase 4 — Document Intelligence (`/api/documents/:id/intelligence`)

All endpoints authorize with `can()` first. An unauthorized read returns `403`
and writes a `DENIED` audit event. RESTRICTED documents are never sent to OCR
or AI providers (`AI_POLICY_BLOCKED`).

| Method & path | Permission | Purpose |
| --- | --- | --- |
| `GET /:id/intelligence` | `document.view` | Returns the current version's processing status, extraction (masked preview only), PII counts, classification, metadata, summary, provenance and job history, plus `policy` and `capabilities` for the caller. `intelligence` is `null` if the version was never processed. |
| `POST /:id/intelligence/reprocess` | `ai.process` | Queues a new attempt and returns `202 { jobId, intelligenceId, status: "QUEUED" }`. Returns `409 PROCESSING_IN_PROGRESS` if a job is already queued or running. Human review decisions are preserved. |
| `POST /:id/intelligence/summary` | `ai.process` | Regenerates the summary from the stored masked text. Errors: `400 NO_EXTRACTED_TEXT`, `403 AI_POLICY_BLOCKED` (RESTRICTED), `502 AI_PROVIDER_ERROR`. |
| `POST /:id/intelligence/classification/review` | `ai.process` (+ `document.version` to apply) | Body: `{ decision: "CONFIRM"\|"CORRECT"\|"REJECT", type?, applyToDocument?, note? }`. `type` is required for `CORRECT`. `applyToDocument` writes the confirmed type to the document record; the audit event records the previous type. |
| `POST /:id/intelligence/metadata/review` | `ai.process` | Body: `{ decision, metadata?, note? }`. `metadata` is a partial object with `caseNumber`, `documentDate` (yyyy-mm-dd), `documentTitle`, `author`, `department`, `evidenceIds[]` and `tags[]`; `null` clears a field. It is required for `CORRECT`, and unknown keys are rejected. The audit event records field **names** only. |

The upload (`POST /api/documents`) and new-version
(`POST /api/documents/:id/versions`) responses now include
`intelligence: { id, jobId, processingStatus: "QUEUED" }`. Processing runs
asynchronously after the upload commits.

## AI — `/api/ai`

Legacy (pre-Phase 4) synchronous endpoints, kept for compatibility. The
Phase 4 pipeline and the Document Intelligence endpoints above supersede them.

- `POST /classify` `{ documentId }`
- `POST /extract-metadata` `{ documentId }`
- `POST /summarize` `{ documentId }`
- `GET /jobs/:id` — job status/result, `aiGenerated: true` fields.

## Security — `/api/security`

- `GET /events` — Security Center feed (`audit.view` or dedicated
  `security.view`).

## Phase 2 — PII Protection & Derivatives (`/api/documents`)

All routes validate `:id` / `:scanId` / `:derivativeId` as UUIDs. Every
authorization decision is made server-side through `can()`.

- `POST /:id/pii-scans` `{ versionNumber? }` (`document.scan`) runs a PII
  scan on the current (or given) version. It returns the scan with
  **masked** findings (`type`, `label`, `confidence`, `pageNumber`,
  `maskedPreview`, `detectionMethod`), plus `coverage` and `limitations`.
  Unreadable formats return `status: "UNSUPPORTED"`. If the source fails
  its integrity check the response is `409 INTEGRITY_VIOLATION`.
- `GET /:id/pii-scans` (`document.scan`) lists recent scans (no findings).
- `GET /:id/pii-scans/:scanId` (`document.scan`) returns one scan with its
  masked findings.
- `POST /:id/redactions` `{ scanId, findingIds[] }` (`document.redact`)
  creates a REDACTED derivative:
  - `201` when `status: "COMPLETED"`;
  - `200` with `status: "UNSUPPORTED" | "FAILED"` and a `statusReason`.

  The original is never modified.
- `POST /:id/watermarks` `{ recipient, purpose, purposeNote?, redactedDerivativeId? }`
  (`document.download`) creates a WATERMARKED derivative of the current
  version or of a redacted copy.
- `GET /:id/derivatives` (`document.view`) lists derived copies (hashes,
  metadata, status).
- `GET /:id/derivatives/:derivativeId/download` (`document.download`)
  returns the derived copy after verifying its hash. It is audited as
  `DOCUMENT_DOWNLOADED`; denials are audited as `DOWNLOAD_DENIED`.

## Phase 2 — Controlled Sharing (`/api/shares`)

- `GET /recipients?documentId=` (`document.share`) lists eligible
  recipients: active users in the case's organization, excluding yourself.
  Emails are not returned.
- `POST /` creates a share:

  ```json
  {
    "documentId": "…",
    "recipientUserId": "…",
    "recipientOrganization": "Prosecutor Office",
    "purpose": "COURT_FILING",
    "purposeNote": "required when purpose = OTHER",
    "startsAt": "optional ISO date",
    "expiresAt": "ISO date",
    "allowDownload": false,
    "applyRedaction": true,
    "redactedDerivativeId": "…",
    "applyWatermark": true,
    "requireApproval": true
  }
  ```

  It returns `{ share, policyAdjustments[] }`. Requires `document.share`.
  Errors:
  - `400 INVALID_RECIPIENT`, `INVALID_SHARE_WINDOW`, `INVALID_DERIVATIVE`,
    `STALE_DERIVATIVE`
  - `403 SHARE_DENIED`
- `GET /?scope=incoming|outgoing|approvals|document&documentId=&status=`
  lists shares. Recipients get a per-share
  `access: { canView, canDownload, reason }` computed by the server policy.
- `GET /:id` returns share detail to the requester, the recipient, or users
  who can view the document. Anyone else gets `403` plus an
  `UNAUTHORIZED_ACCESS_ATTEMPT` audit event.
- `POST /:id/approve | /:id/reject` `{ note? }` requires `access.approve`
  on the case and must come from someone other than the requester
  (`403 SEPARATION_OF_DUTIES` otherwise).
- `POST /:id/revoke` `{ note? }` can be called by the requester or by a
  user with `access.revoke` / `access.approve`.
- `GET /:id/view` (inline) and `GET /:id/download` (attachment) serve the
  recipient's protected copy (redacted and/or watermarked as the share
  requires). Both are re-evaluated on every call and sent with
  `Cache-Control: no-store`. Denials return `403` with one of:
  `NOT_RECIPIENT`, `TENANT_MISMATCH`, `SHARE_PENDING`, `SHARE_REJECTED`,
  `SHARE_REVOKED`, `SHARE_EXPIRED`, `SHARE_NOT_STARTED`,
  `DOWNLOAD_NOT_PERMITTED`.

The audit list (`GET /api/audit`) also accepts `documentId=`. Audit items
include a sanitized `metadata` object.

## Sample: Document upload response

```json
{
  "document": {
    "id": "b6f8...",
    "documentNumber": "DOC-2026-001842",
    "caseId": "c19a...",
    "title": "Forensic_Report.pdf",
    "type": "FORENSIC_REPORT",
    "confidentiality": "CONFIDENTIAL",
    "currentVersion": {
      "versionNumber": 1,
      "sha256Hash": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      "integrityStatus": "VERIFIED",
      "uploadedBy": "investigator@caseshield.local",
      "uploadedAt": "2026-09-20T10:32:00.000Z"
    }
  }
}
```

## Sample: Integrity violation response

```json
{
  "status": "VIOLATION",
  "registeredHash": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  "currentHash": "1c8bfe8f801d79745c4631be870ce0e0b8b7d8fbb0e6c5f7d19c02b6a3d6a5b1",
  "message": "The calculated file hash does not match the registered hash for this document version."
}
```
