-- =============================================================================
-- Case Shield - embedded demo schema (SQLite)
-- -----------------------------------------------------------------------------
-- This mirrors, table-for-table and column-for-column, the production
-- PostgreSQL schema used by the real backend (see /backend and /prisma at
-- the repository root). It exists so the prototype runs with zero external
-- configuration.
-- =============================================================================

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  employee_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  department TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS role_permissions (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  resource_type TEXT NOT NULL,   -- case | document | evidence | custody | access_request | audit | system
  action TEXT NOT NULL,          -- view | download | upload | edit_metadata | verify_integrity | approve | manage
  effect TEXT NOT NULL           -- ALLOW | DENY
);

CREATE TABLE IF NOT EXISTS courts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS case_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS case_types (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES case_categories(id),
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cases (
  id TEXT PRIMARY KEY,
  case_number TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  case_type_id TEXT NOT NULL REFERENCES case_types(id),
  court_id TEXT NOT NULL REFERENCES courts(id),
  status TEXT NOT NULL,
  priority TEXT NOT NULL,
  summary TEXT,
  assigned_investigator_id TEXT REFERENCES users(id),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS case_stakeholders (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role_in_case TEXT NOT NULL,
  added_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id),
  document_number TEXT UNIQUE NOT NULL,
  filename TEXT NOT NULL,
  document_type TEXT NOT NULL,
  description TEXT,
  confidentiality_level TEXT NOT NULL, -- Restricted | Confidential | Internal | Case Team Only
  access_level TEXT NOT NULL,          -- mirrors confidentiality for display
  tags TEXT,                            -- comma separated
  current_version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'Active', -- Active | Superseded | Archived
  uploaded_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS document_versions (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id),
  version_number INTEGER NOT NULL,
  previous_version_id TEXT REFERENCES document_versions(id),
  storage_path TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  mime_type TEXT,
  size_bytes INTEGER,
  sha256_hash TEXT NOT NULL,
  uploaded_by TEXT NOT NULL REFERENCES users(id),
  change_description TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS document_signatures (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id),
  version_id TEXT NOT NULL REFERENCES document_versions(id),
  signer_id TEXT REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'Integration Ready', -- Integration Ready | Signed | Rejected
  signed_at TEXT,
  document_hash TEXT NOT NULL,
  verification_status TEXT NOT NULL DEFAULT 'Not Applicable'
);

CREATE TABLE IF NOT EXISTS evidence (
  id TEXT PRIMARY KEY,
  evidence_code TEXT UNIQUE NOT NULL,
  case_id TEXT NOT NULL REFERENCES cases(id),
  evidence_type TEXT NOT NULL,
  description TEXT NOT NULL,
  collected_by TEXT NOT NULL REFERENCES users(id),
  collection_date TEXT NOT NULL,
  current_custodian_id TEXT REFERENCES users(id),
  integrity_status TEXT NOT NULL DEFAULT 'Verified', -- Verified | Unverified | Violation
  chain_status TEXT NOT NULL DEFAULT 'In Custody',   -- In Custody | Transferred | Released | Archived
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS custody_events (
  id TEXT PRIMARY KEY,
  evidence_id TEXT NOT NULL REFERENCES evidence(id),
  from_person_id TEXT REFERENCES users(id),
  to_person_id TEXT REFERENCES users(id),
  from_role TEXT,
  to_role TEXT,
  action TEXT NOT NULL, -- Collected | Transferred | Received | Examined | Verified | Submitted | Released | Archived
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'Completed',
  event_timestamp TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS access_requests (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id),
  requester_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL,
  resource_type TEXT NOT NULL, -- document | evidence | case
  resource_id TEXT,
  resource_label TEXT,
  permission TEXT NOT NULL,    -- View | Download | Upload | Edit Metadata | Verify Integrity
  reason TEXT NOT NULL,
  requested_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expiry TEXT,
  status TEXT NOT NULL DEFAULT 'Pending', -- Pending | Approved | Rejected | Expired | Revoked
  reviewer_id TEXT REFERENCES users(id),
  reviewed_at TEXT
);

CREATE TABLE IF NOT EXISTS document_permissions (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  permission TEXT NOT NULL,
  granted_by TEXT REFERENCES users(id),
  granted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at TEXT,
  source_access_request_id TEXT REFERENCES access_requests(id)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  event_timestamp TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  actor_id TEXT REFERENCES users(id),
  actor_name TEXT,
  role TEXT,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  case_id TEXT REFERENCES cases(id),
  result TEXT NOT NULL, -- Success | Failure | Denied
  metadata TEXT,          -- canonical JSON string
  previous_event_hash TEXT,
  event_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS integrity_ledger (
  id TEXT PRIMARY KEY,
  anchor_type TEXT NOT NULL, -- document_hash | audit_hash
  reference_id TEXT NOT NULL,
  hash_value TEXT NOT NULL,
  anchored_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  note TEXT NOT NULL DEFAULT 'Local demonstration ledger - not a public blockchain'
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  link TEXT,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_documents_case ON documents(case_id);
CREATE INDEX IF NOT EXISTS idx_versions_document ON document_versions(document_id);
CREATE INDEX IF NOT EXISTS idx_evidence_case ON evidence(case_id);
CREATE INDEX IF NOT EXISTS idx_custody_evidence ON custody_events(evidence_id);
CREATE INDEX IF NOT EXISTS idx_audit_case ON audit_events(case_id);
CREATE INDEX IF NOT EXISTS idx_access_case ON access_requests(case_id);
