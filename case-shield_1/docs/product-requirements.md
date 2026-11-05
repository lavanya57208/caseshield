# Case Shield — Product Requirements Document

## 1. Summary

Case Shield is a secure digital document and case-management platform for
sensitive legal and investigation records. It gives investigators, forensic
officers, prosecutors, courts, lawyers, and auditors a single controlled
system of record for FIRs, investigation reports, witness statements,
charge sheets, court filings, evidence, and forensic reports, replacing
fragmented storage (shared drives, email, physical files) with a system that
provides fine-grained access control, cryptographic integrity verification,
evidence chain-of-custody tracking, and a tamper-evident audit trail.

Case Shield is a **prototype built for the Smart India Hackathon**. It is
architected as if it could evolve into infrastructure for large-scale Indian
legal and investigative workflows, but it is **not** an official government
system, makes no compliance claims, and would require formal security
assessment, procurement approval, and integration with authorized systems
before any real deployment.

## 2. Problems Addressed

| # | Problem | How Case Shield addresses it |
|---|---------|-------------------------------|
| 1 | Fragmented document storage | Single case-centric document store with structured metadata |
| 2 | Difficulty finding case documents | Case/document search with authorization-aware filters |
| 3 | Unauthorized access | Person → Role → Org → Case → Document → Permission → Action model |
| 4 | Unauthorized modification | Server-side authorization on every mutating action; no client-trusted state |
| 5 | Document tampering | SHA-256 hash registered per version; on-demand integrity verification |
| 6 | Lack of version control | Append-only document version history, never overwritten |
| 7 | Poor collaboration | Access-request workflow, case assignment, shared case workspace |
| 8 | Weak auditability | Append-oriented audit_events table covering all sensitive actions |
| 9 | Evidence custody tracking | Dedicated custody_events chain-of-custody ledger |
| 10 | Delays in document retrieval | Centralized case workspace, indexed search |
| 11 | Difficulty verifying integrity | One-click hash recomputation vs. registered hash |
| 12 | Lack of centralized case context | Case Workspace aggregates documents, evidence, custody, audit, access |

## 3. Non-Goals (explicitly out of scope for this prototype)

- Legally binding digital signatures (architecture is signature-*ready* only)
- Blockchain as a core dependency (see `docs/architecture.md` §Blockchain Stance)
- Claims of official Government of India status, integration, or approval
- Real malware scanning (a scanning **integration point** is implemented and mocked)
- Guarantees of legal admissibility or "tamper-proof forever" storage
- Multi-tenant SaaS billing, horizontal microservices, Kubernetes at this stage

## 4. Users & Roles

Investigator/Police Officer, Senior Investigator, Forensic Officer,
Prosecutor, Judge/Court Authority, Lawyer/Advocate, Court Staff, Authorized
Party/Litigant, System Administrator, Auditor/Compliance Officer. Roles are
configuration-driven (`role` + `permission` + `role_permission` tables), not
hardcoded enums scattered through business logic. "Viewer" is a permission
level (`*.view` grants), not a profession.

Authorization is **not** role-only:

```
Person → Role → Organization → Case → Document → Permission → Action
```

A user's effective permission on a specific document is the combination of
their role's baseline grants, any case-level assignment/permission override,
and any document-level permission override — evaluated server-side on every
request.

## 5. Information Architecture

Login · Dashboard · Cases · Case Workspace (Overview / Documents / Evidence /
Chain of Custody / Audit Trail / Access Control / Activity) · Search ·
Notifications · Audit · Profile & Security · Administration.

## 6. Key Functional Requirements

1. Email + password login with MFA-ready flow, seeded demo identities in
   development mode.
2. Role-aware dashboard summarizing active cases, pending actions, integrity
   alerts, and recent activity.
3. Case CRUD with structured classification (Court/Forum → Category → Type →
   Case), status, priority, confidentiality, and assignment.
4. Document upload with server-side MIME/size/signature validation, SHA-256
   hashing, versioning, and audit logging.
5. On-demand integrity verification comparing the registered hash of a
   version against a freshly computed hash of the stored object.
6. Evidence records linked to a case, with a chain-of-custody ledger
   recording every collect/register/transfer/receive/examine/submit/release
   event.
7. Access-request workflow: request → approve/reject → audit → active
   permission, with expiry/revocation.
8. Append-oriented audit trail covering all security-sensitive actions.
9. Authorization-aware search across cases, documents, and evidence.
10. Notifications for access, custody, integrity, and security events.
11. AI-assisted metadata extraction/classification/summarization, clearly
    labeled "AI GENERATED" and user-correctable; AI never bypasses
    authorization or makes legal determinations.
12. Administration area for users, roles, permissions, categories, and
    retention policy configuration, itself fully audited.

## 7. Key Non-Functional Requirements

- Security-by-default: deny-by-default authorization, no client-trusted
  identifiers, no secrets in source or frontend.
- Cloud-ready: business logic depends on provider **interfaces**
  (`StorageProvider`, `IdentityProvider`, `KeyManagementProvider`,
  `AIProvider`, `NotificationProvider`), swappable between local/dev and
  Google Cloud implementations without touching domain logic.
- Auditability: every sensitive action produces an audit event with actor,
  action, resource, result, and correlation ID.
- Accessibility: semantic HTML, keyboard navigation, visible focus, ARIA
  labelling, status never conveyed by color alone.
- Honest language: no unsupported claims ("100% legally admissible",
  "tamper-proof forever", "Government approved"); see
  `docs/security-architecture.md` §Language Policy.

## 8. Success Criteria for the Prototype

A reviewer can, in under five minutes: log in as an Investigator, open a
case, upload a document, see its SHA-256 hash and version recorded, view its
evidence and chain-of-custody timeline, see a Prosecutor's access request
get approved, and see every one of those actions land in the audit trail —
all enforced server-side, not just hidden in the UI.
