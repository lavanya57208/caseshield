// Central permission catalog — see docs/security-architecture.md §5 and
// docs/product-requirements.md §4. Every permission key follows
// "resource.action". This file is the single source of truth consumed by
// the Prisma seed script and by authorize() middleware calls, so a typo in
// a route's required permission fails fast rather than silently allowing.

export const PERMISSIONS = {
  CASE_VIEW: "case.view",
  CASE_CREATE: "case.create",
  CASE_UPDATE: "case.update",
  CASE_ASSIGN: "case.assign",

  DOCUMENT_VIEW: "document.view",
  DOCUMENT_UPLOAD: "document.upload",
  DOCUMENT_DOWNLOAD: "document.download",
  DOCUMENT_SHARE: "document.share",
  DOCUMENT_VERSION: "document.version",
  DOCUMENT_VERIFY: "document.verify",
  DOCUMENT_SCAN: "document.scan",
  DOCUMENT_REDACT: "document.redact",

  EVIDENCE_VIEW: "evidence.view",
  EVIDENCE_REGISTER: "evidence.register",
  EVIDENCE_TRANSFER: "evidence.transfer",
  EVIDENCE_RECEIVE: "evidence.receive",
  EVIDENCE_EXAMINE: "evidence.examine",
  EVIDENCE_SEAL: "evidence.seal",
  EVIDENCE_SUBMIT: "evidence.submit",
  EVIDENCE_ARCHIVE: "evidence.archive",
  EVIDENCE_VERIFY: "evidence.verify",

  AUDIT_VIEW: "audit.view",

  ACCESS_REQUEST: "access.request",
  ACCESS_APPROVE: "access.approve",
  ACCESS_REVOKE: "access.revoke",

  AI_PROCESS: "ai.process",

  ADMIN_MANAGE: "admin.manage",
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: { key: PermissionKey; resource: string; action: string; description: string }[] = [
  { key: PERMISSIONS.CASE_VIEW, resource: "case", action: "view", description: "View a case and its workspace" },
  { key: PERMISSIONS.CASE_CREATE, resource: "case", action: "create", description: "Create a new case" },
  { key: PERMISSIONS.CASE_UPDATE, resource: "case", action: "update", description: "Update case metadata" },
  { key: PERMISSIONS.CASE_ASSIGN, resource: "case", action: "assign", description: "Assign users to a case team" },

  { key: PERMISSIONS.DOCUMENT_VIEW, resource: "document", action: "view", description: "View document metadata" },
  { key: PERMISSIONS.DOCUMENT_UPLOAD, resource: "document", action: "upload", description: "Upload a document" },
  { key: PERMISSIONS.DOCUMENT_DOWNLOAD, resource: "document", action: "download", description: "Download the stored file" },
  { key: PERMISSIONS.DOCUMENT_SHARE, resource: "document", action: "share", description: "Grant another user access" },
  { key: PERMISSIONS.DOCUMENT_VERSION, resource: "document", action: "version", description: "Upload a new version" },
  { key: PERMISSIONS.DOCUMENT_VERIFY, resource: "document", action: "verify", description: "Run integrity verification" },
  { key: PERMISSIONS.DOCUMENT_SCAN, resource: "document", action: "scan", description: "Run a PII scan and review masked findings" },
  { key: PERMISSIONS.DOCUMENT_REDACT, resource: "document", action: "redact", description: "Create a redacted derivative copy" },

  { key: PERMISSIONS.EVIDENCE_VIEW, resource: "evidence", action: "view", description: "View evidence records" },
  { key: PERMISSIONS.EVIDENCE_REGISTER, resource: "evidence", action: "register", description: "Register new evidence" },
  { key: PERMISSIONS.EVIDENCE_TRANSFER, resource: "evidence", action: "transfer", description: "Initiate a custody transfer of evidence you hold" },
  { key: PERMISSIONS.EVIDENCE_RECEIVE, resource: "evidence", action: "receive", description: "Accept or reject evidence transferred to you" },
  { key: PERMISSIONS.EVIDENCE_EXAMINE, resource: "evidence", action: "examine", description: "Record a forensic examination of evidence you hold" },
  { key: PERMISSIONS.EVIDENCE_SEAL, resource: "evidence", action: "seal", description: "Seal or unseal evidence you hold" },
  { key: PERMISSIONS.EVIDENCE_SUBMIT, resource: "evidence", action: "submit", description: "Submit evidence you hold to court and record its return" },
  { key: PERMISSIONS.EVIDENCE_ARCHIVE, resource: "evidence", action: "archive", description: "Archive evidence at the end of its lifecycle" },
  { key: PERMISSIONS.EVIDENCE_VERIFY, resource: "evidence", action: "verify", description: "Verify evidence integrity and the custody hash chain" },

  { key: PERMISSIONS.AUDIT_VIEW, resource: "audit", action: "view", description: "View the audit trail" },

  { key: PERMISSIONS.ACCESS_REQUEST, resource: "access", action: "request", description: "Request access to a case/document" },
  { key: PERMISSIONS.ACCESS_APPROVE, resource: "access", action: "approve", description: "Approve/reject access requests" },
  { key: PERMISSIONS.ACCESS_REVOKE, resource: "access", action: "revoke", description: "Revoke a granted permission" },

  { key: PERMISSIONS.AI_PROCESS, resource: "ai", action: "process", description: "Invoke AI document processing" },

  { key: PERMISSIONS.ADMIN_MANAGE, resource: "admin", action: "manage", description: "Manage users, roles, and system settings" },
];

// Role baseline grants — the RBAC layer. Case/document-level ABAC overrides
// (case_permissions / document_permissions) narrow or widen this per
// docs/security-architecture.md §5.
export const ROLE_BASELINE_PERMISSIONS: Record<string, PermissionKey[]> = {
  INVESTIGATOR: [
    PERMISSIONS.CASE_VIEW,
    PERMISSIONS.DOCUMENT_VIEW,
    PERMISSIONS.DOCUMENT_UPLOAD,
    PERMISSIONS.DOCUMENT_DOWNLOAD,
    PERMISSIONS.DOCUMENT_VERSION,
    PERMISSIONS.DOCUMENT_VERIFY,
    PERMISSIONS.DOCUMENT_SCAN,
    PERMISSIONS.DOCUMENT_REDACT,
    PERMISSIONS.EVIDENCE_VIEW,
    PERMISSIONS.EVIDENCE_REGISTER,
    PERMISSIONS.EVIDENCE_TRANSFER,
    PERMISSIONS.EVIDENCE_RECEIVE,
    PERMISSIONS.EVIDENCE_SEAL,
    PERMISSIONS.EVIDENCE_VERIFY,
    PERMISSIONS.ACCESS_REQUEST,
    PERMISSIONS.AI_PROCESS,
  ],
  SENIOR_INVESTIGATOR: [
    PERMISSIONS.CASE_VIEW,
    PERMISSIONS.CASE_CREATE,
    PERMISSIONS.CASE_UPDATE,
    PERMISSIONS.CASE_ASSIGN,
    PERMISSIONS.DOCUMENT_VIEW,
    PERMISSIONS.DOCUMENT_UPLOAD,
    PERMISSIONS.DOCUMENT_DOWNLOAD,
    PERMISSIONS.DOCUMENT_SHARE,
    PERMISSIONS.DOCUMENT_VERSION,
    PERMISSIONS.DOCUMENT_VERIFY,
    PERMISSIONS.DOCUMENT_SCAN,
    PERMISSIONS.DOCUMENT_REDACT,
    PERMISSIONS.EVIDENCE_VIEW,
    PERMISSIONS.EVIDENCE_REGISTER,
    PERMISSIONS.EVIDENCE_TRANSFER,
    PERMISSIONS.EVIDENCE_RECEIVE,
    PERMISSIONS.EVIDENCE_SEAL,
    PERMISSIONS.EVIDENCE_SUBMIT,
    PERMISSIONS.EVIDENCE_ARCHIVE,
    PERMISSIONS.EVIDENCE_VERIFY,
    PERMISSIONS.ACCESS_REQUEST,
    PERMISSIONS.ACCESS_APPROVE,
    PERMISSIONS.AUDIT_VIEW,
    PERMISSIONS.AI_PROCESS,
  ],
  FORENSIC_OFFICER: [
    PERMISSIONS.CASE_VIEW,
    PERMISSIONS.DOCUMENT_VIEW,
    PERMISSIONS.DOCUMENT_UPLOAD,
    PERMISSIONS.DOCUMENT_DOWNLOAD,
    PERMISSIONS.DOCUMENT_VERSION,
    PERMISSIONS.DOCUMENT_VERIFY,
    PERMISSIONS.DOCUMENT_SCAN,
    PERMISSIONS.DOCUMENT_REDACT,
    PERMISSIONS.EVIDENCE_VIEW,
    PERMISSIONS.EVIDENCE_REGISTER,
    PERMISSIONS.EVIDENCE_TRANSFER,
    PERMISSIONS.EVIDENCE_RECEIVE,
    PERMISSIONS.EVIDENCE_EXAMINE,
    PERMISSIONS.EVIDENCE_SEAL,
    PERMISSIONS.EVIDENCE_VERIFY,
    PERMISSIONS.ACCESS_REQUEST,
    PERMISSIONS.AI_PROCESS,
  ],
  PROSECUTOR: [
    PERMISSIONS.CASE_VIEW,
    PERMISSIONS.DOCUMENT_VIEW,
    PERMISSIONS.DOCUMENT_DOWNLOAD,
    PERMISSIONS.DOCUMENT_VERIFY,
    PERMISSIONS.EVIDENCE_VIEW,
    PERMISSIONS.EVIDENCE_TRANSFER,
    PERMISSIONS.EVIDENCE_RECEIVE,
    PERMISSIONS.EVIDENCE_SUBMIT,
    PERMISSIONS.EVIDENCE_VERIFY,
    PERMISSIONS.ACCESS_REQUEST,
    PERMISSIONS.AI_PROCESS,
  ],
  JUDGE: [
    PERMISSIONS.CASE_VIEW,
    PERMISSIONS.DOCUMENT_VIEW,
    PERMISSIONS.DOCUMENT_VERIFY,
    PERMISSIONS.EVIDENCE_VIEW,
    PERMISSIONS.EVIDENCE_VERIFY,
    PERMISSIONS.AUDIT_VIEW,
  ],
  LAWYER: [
    PERMISSIONS.CASE_VIEW,
    PERMISSIONS.DOCUMENT_VIEW,
    PERMISSIONS.ACCESS_REQUEST,
  ],
  COURT_STAFF: [
    PERMISSIONS.CASE_VIEW,
    PERMISSIONS.DOCUMENT_VIEW,
    PERMISSIONS.DOCUMENT_DOWNLOAD,
    PERMISSIONS.ACCESS_REQUEST,
  ],
  AUTHORIZED_PARTY: [
    PERMISSIONS.ACCESS_REQUEST,
  ],
  AUDITOR: [
    PERMISSIONS.CASE_VIEW,
    PERMISSIONS.DOCUMENT_VIEW,
    PERMISSIONS.EVIDENCE_VIEW,
    PERMISSIONS.EVIDENCE_VERIFY,
    PERMISSIONS.AUDIT_VIEW,
  ],
  ADMIN: [
    PERMISSIONS.CASE_VIEW,
    PERMISSIONS.CASE_CREATE,
    PERMISSIONS.CASE_UPDATE,
    PERMISSIONS.CASE_ASSIGN,
    PERMISSIONS.DOCUMENT_VIEW,
    PERMISSIONS.AUDIT_VIEW,
    PERMISSIONS.ACCESS_APPROVE,
    PERMISSIONS.ACCESS_REVOKE,
    PERMISSIONS.ADMIN_MANAGE,
  ],
};

// Deliberately NOT granted to any default role: document.delete /
// evidence.delete do not exist as permissions at all in this prototype —
// deletion is out of scope by design (see docs/security-architecture.md §14).
