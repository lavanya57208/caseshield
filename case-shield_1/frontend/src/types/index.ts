// Shared frontend types — mirrors backend DTOs. See docs/api.md and
// docs/database.md. Kept intentionally close to the Prisma models so the
// UI can display exactly what the API returns without a translation layer.

export type RoleKey =
  | "INVESTIGATOR"
  | "SENIOR_INVESTIGATOR"
  | "FORENSIC_OFFICER"
  | "PROSECUTOR"
  | "JUDGE"
  | "LAWYER"
  | "COURT_STAFF"
  | "AUTHORIZED_PARTY"
  | "AUDITOR"
  | "ADMIN";

export interface Role {
  key: RoleKey;
  name: string;
}

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  department?: string | null;
  officialIdentifier?: string | null;
  organization?: string;
  organizationId?: string;
  roles: Role[];
  mfaEnabled: boolean;
  lastLoginAt?: string | null;
}

export type CaseStatus = "ACTIVE" | "UNDER_REVIEW" | "ON_HOLD" | "CLOSED" | "ARCHIVED";
export type CasePriority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type Confidentiality = "PUBLIC" | "INTERNAL" | "CONFIDENTIAL" | "HIGHLY_CONFIDENTIAL" | "RESTRICTED";

export interface CaseCategory {
  id: string;
  key: string;
  name: string;
  types: CaseType[];
}
export interface CaseType {
  id: string;
  key: string;
  name: string;
  categoryId: string;
}

export interface CaseSummary {
  id: string;
  caseNumber: string;
  title: string;
  status: CaseStatus;
  priority: CasePriority;
  confidentiality: Confidentiality;
  court: string;
  jurisdiction: string;
  categoryId: string;
  typeId: string;
  category: { id: string; name: string };
  type: { id: string; name: string };
  investigatingOfficerId?: string | null;
  investigatingOfficer?: { id: string; fullName: string } | null;
  lastActivityAt: string;
  openedAt: string;
  createdAt: string;
  updatedAt: string;
  _count?: { documents: number; evidence: number };
}

export interface AssignableOfficer {
  id: string;
  fullName: string;
  department?: string | null;
  role: string;
}

export interface CaseDetail extends CaseSummary {
  description: string;
  organization: { name: string };
  assignments: { user: { id: string; fullName: string; email: string }; roleOnCase: string }[];
  tags: { tag: string }[];
}

export type DocumentType =
  | "FIR"
  | "INVESTIGATION_REPORT"
  | "WITNESS_STATEMENT"
  | "CHARGE_SHEET"
  | "COURT_FILING"
  | "EVIDENCE_RECORD"
  | "FORENSIC_REPORT"
  | "LEGAL_NOTICE"
  | "JUDGMENT"
  | "ORDER"
  | "SUPPORTING_DOCUMENT";

export type IntegrityStatus = "VERIFIED" | "VIOLATION" | "UNVERIFIED";

export interface DocumentVersion {
  id: string;
  versionNumber: number;
  fileName: string;
  fileSize: number;
  mimeType: string;
  sha256Hash: string;
  integrityStatus: IntegrityStatus;
  lastVerifiedAt?: string | null;
  changeNote?: string | null;
  uploadedBy: string;
  uploader?: { id: string; fullName: string };
  uploadedAt: string;
}

export interface DocumentSummary {
  id: string;
  documentNumber: string;
  caseId: string;
  type: DocumentType;
  title: string;
  description?: string | null;
  confidentiality: Confidentiality;
  status: string;
  createdAt: string;
  updatedAt: string;
  versions: DocumentVersion[];
  tags: { tag: string }[];
}

// --- Phase 3: evidence & chain of custody -------------------------------------

export type EvidenceType =
  | "DOCUMENT"
  | "PHOTOGRAPH"
  | "VIDEO"
  | "AUDIO"
  | "FORENSIC_REPORT"
  | "DIGITAL_EVIDENCE"
  | "PHYSICAL_EVIDENCE"
  | "DEVICE"
  | "BIOLOGICAL_SAMPLE"
  | "OTHER";

export type EvidenceStatus =
  | "REGISTERED"
  | "IN_CUSTODY"
  | "UNDER_EXAMINATION"
  | "TRANSFERRED"
  | "SUBMITTED_TO_COURT"
  | "RETURNED"
  | "SEALED"
  | "ARCHIVED";

/** Server-computed: the UI only offers what the backend would accept. */
export type EvidenceUiAction =
  | "VIEW"
  | "TRANSFER"
  | "ACCEPT_TRANSFER"
  | "REJECT_TRANSFER"
  | "CANCEL_TRANSFER"
  | "EXAMINE"
  | "SEAL"
  | "UNSEAL"
  | "SUBMIT"
  | "RETURN"
  | "ARCHIVE"
  | "VERIFY_INTEGRITY"
  | "VERIFY_CUSTODY"
  | "VIEW_AUDIT";

export interface PersonRef {
  id: string;
  fullName: string;
  department?: string | null;
}

export interface EvidenceItem {
  id: string;
  evidenceNumber: string;
  caseId: string;
  case: { id: string; caseNumber: string; title: string };
  title: string;
  type: EvidenceType;
  description: string;
  source?: string | null;
  collectedAt: string;
  location?: string | null;
  status: EvidenceStatus;
  confidentiality: Confidentiality;
  notes?: string | null;
  collectedBy: PersonRef;
  registeredBy: PersonRef;
  currentCustodian?: PersonRef | null;
  originalHash?: string | null;
  currentHash?: string | null;
  integrityStatus?: IntegrityStatus | null;
  lastVerifiedAt?: string | null;
  submittedAt?: string | null;
  custodyEventCount: number;
  custodyHeadHash?: string | null;
  lastActivityAt: string;
  createdAt: string;
  originalDocument?: {
    id: string;
    documentNumber: string;
    title: string | null;
    type: string;
    versionNumber: number;
    fileName: string | null;
    mimeType: string;
    fileSize: number;
    registeredVersionHash: string;
    canView: boolean;
  } | null;
  pendingTransfer?: {
    id: string;
    fromCustodian: PersonRef;
    toCustodian: PersonRef;
    initiatedBy: PersonRef;
    reason: string;
    notes?: string | null;
    initiatedAt: string;
  } | null;
  allowedActions: EvidenceUiAction[];
}

export type CustodyAction =
  | "COLLECTED"
  | "REGISTERED"
  | "TRANSFERRED"
  | "RECEIVED"
  | "TRANSFER_REJECTED"
  | "TRANSFER_CANCELLED"
  | "EXAMINED"
  | "SEALED"
  | "UNSEALED"
  | "SUBMITTED"
  | "RETURNED"
  | "ARCHIVED"
  | "VIEWED"
  | "VERIFIED";

export interface CustodyEvent {
  id: string;
  sequence: number;
  action: CustodyAction;
  reason: string;
  notes?: string | null;
  location?: string | null;
  occurredAt: string;
  fromUser?: PersonRef | null;
  toUser?: PersonRef | null;
  actor: PersonRef;
  transfer?: { id: string; status: "PENDING" | "ACCEPTED" | "REJECTED" | "CANCELLED" } | null;
  hashAtEvent?: string | null;
  previousEventHash?: string | null;
  eventHash?: string | null;
}

export interface CustodyTimelineResponse {
  evidenceNumber: string;
  headHash: string | null;
  eventCount: number;
  events: CustodyEvent[];
}

export interface IntegrityVerificationResult {
  status: "VERIFIED" | "VIOLATION";
  label: string;
  registeredHash: string;
  currentHash: string | null;
  verifiedAt: string;
  message: string;
}

export interface CustodyChainVerificationResult {
  status: "VERIFIED" | "VIOLATION";
  label: string;
  eventsChecked: number;
  headHash: string | null;
  verifiedAt: string;
  message: string;
  failures: {
    code: "UNSEALED_EVENT" | "SEQUENCE_GAP" | "BROKEN_LINK" | "HASH_MISMATCH" | "HEAD_MISMATCH";
    eventId: string | null;
    sequence: number | null;
    expectedHash: string | null;
    storedHash: string | null;
    message: string;
  }[];
}

export interface CustodianCandidate {
  id: string;
  fullName: string;
  department?: string | null;
  roles: { key: RoleKey; name: string }[];
}

export interface IncomingTransfer {
  id: string;
  evidence: { id: string; evidenceNumber: string; title: string; caseId: string; case: { caseNumber: string } };
  fromCustodian: PersonRef;
  reason: string;
  initiatedAt: string;
}

export type AccessRequestStatus = "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED" | "REVOKED";

export interface AccessRequest {
  id: string;
  caseId: string;
  documentId?: string | null;
  permissionKey: string;
  reason: string;
  status: AccessRequestStatus;
  durationDays?: number | null;
  createdAt: string;
  requestedBy?: { fullName: string; email: string };
  case?: { caseNumber: string; title: string };
}

export interface AuditEvent {
  id: string;
  actorId?: string | null;
  actorRole?: string | null;
  action: string;
  resource: string;
  caseId?: string | null;
  documentId?: string | null;
  result: "SUCCESS" | "DENIED" | "ERROR";
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
  requestId?: string;
  occurredAt: string;
  evidenceId?: string | null;
  organizationId?: string | null;
  actor?: { fullName: string; email?: string } | null;
  case?: { caseNumber: string } | null;
  evidence?: { evidenceNumber: string } | null;
  document?: { documentNumber: string } | null;
}

export interface AuditFacets {
  orgWide: boolean;
  organization: { id: string; name: string } | null;
  cases: { id: string; caseNumber: string; title: string }[];
  evidence: { id: string; evidenceNumber: string; title: string; caseId: string }[];
  actors: { id: string; fullName: string }[];
  actions: string[];
  results: ("SUCCESS" | "DENIED" | "ERROR")[];
}

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  isRead: boolean;
  createdAt: string;
  relatedCaseId?: string | null;
  relatedEvidenceId?: string | null;
}

export interface ApiErrorShape {
  error: { code: string; message: string; requestId: string };
}

// --- Phase 2: PII protection, derivatives, controlled sharing --------------

export type PiiType = "AADHAAR_LIKE" | "PHONE_NUMBER" | "EMAIL_ADDRESS" | "IP_ADDRESS" | "ADDRESS_LIKE";
export type PiiConfidence = "LOW" | "MEDIUM" | "HIGH";

/** Masked metadata only — the API never returns raw detected values. */
export interface PiiFinding {
  id: string;
  type: PiiType;
  label: string;
  confidence: PiiConfidence;
  pageNumber?: number | null;
  maskedPreview: string;
  detectionMethod: string;
}

export interface PiiScan {
  id: string;
  documentId: string;
  versionNumber?: number;
  status: "RUNNING" | "COMPLETED" | "FAILED" | "UNSUPPORTED";
  provider: string;
  textLayer: boolean;
  pageCount?: number | null;
  findingCount: number;
  limitations: string[];
  statusReason?: string | null;
  startedAt: string;
  completedAt?: string | null;
  requestedBy?: { fullName: string };
  coverage: Record<PiiType, "PATTERN" | "HEURISTIC_LIMITED" | "NOT_SUPPORTED">;
  findings: PiiFinding[];
}

export interface DocumentDerivative {
  id: string;
  documentId: string;
  sourceVersionNumber?: number;
  parentDerivativeId?: string | null;
  type: "REDACTED" | "WATERMARKED";
  status: "PENDING" | "COMPLETED" | "FAILED" | "UNSUPPORTED";
  statusReason?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
  sha256Hash?: string | null;
  redactionMetadata?: { redactedCount?: number; countsByType?: Record<string, number>; notes?: string[]; verification?: string } | null;
  watermarkMetadata?: { recipient?: string; purposeLabel?: string; copyReference?: string; notes?: string[] } | null;
  shareId?: string | null;
  createdAt: string;
  createdBy?: { fullName: string };
}

export type SharePurpose =
  | "INVESTIGATION"
  | "FORENSIC_EXAMINATION"
  | "COURT_FILING"
  | "LEGAL_REVIEW"
  | "EVIDENCE_VERIFICATION"
  | "ADMINISTRATIVE_REVIEW"
  | "OTHER";

export interface DocumentShare {
  id: string;
  documentId: string;
  caseId: string;
  sourceVersionNumber: number;
  document: { id: string; documentNumber: string; title: string; type: string; confidentiality: Confidentiality };
  case: { id: string; caseNumber: string; title: string };
  requestedBy: { id: string; fullName: string };
  recipient: { id: string; fullName: string; department?: string | null };
  recipientOrganization?: string | null;
  purpose: SharePurpose;
  purposeLabel: string;
  startsAt: string;
  expiresAt: string;
  allowDownload: boolean;
  applyRedaction: boolean;
  applyWatermark: boolean;
  requireApproval: boolean;
  status: AccessRequestStatus;
  reviewedBy?: { fullName: string } | null;
  reviewNote?: string | null;
  revokedAt?: string | null;
  createdAt: string;
  deliveredCopies: number;
  access?: { canView: boolean; canDownload: boolean; reason?: string };
}

export interface ShareRecipient {
  id: string;
  fullName: string;
  department?: string | null;
  organization: string;
  roles: { key: RoleKey; name: string }[];
}

// --- Phase 4: document intelligence & search ---------------------------------

export type ProcessingStatus = "QUEUED" | "PROCESSING" | "COMPLETED" | "PARTIAL" | "FAILED";
export type ExtractionStatus = "QUEUED" | "PROCESSING" | "TEXT_EXTRACTED" | "OCR_PROCESSED" | "PARTIAL" | "FAILED" | "UNSUPPORTED" | "SKIPPED";
export type StepStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "SKIPPED" | "FAILED";
export type ReviewStatus = "PENDING_REVIEW" | "CONFIRMED" | "REJECTED";
export type AiProvenance = "AI_GENERATED" | "AI_ASSISTED" | "HUMAN_CONFIRMED";
export type ReviewDecision = "CONFIRM" | "CORRECT" | "REJECT";

export interface MetadataValue<T = string> {
  value: T | null;
  confidence: number;
}

export interface StructuredDocumentMetadata {
  caseNumber: MetadataValue;
  documentDate: MetadataValue;
  documentTitle: MetadataValue;
  documentType: MetadataValue;
  author: MetadataValue;
  department: MetadataValue;
  evidenceIds: MetadataValue<string[]>;
  parties: MetadataValue<{ role: string; name: string }[]>;
  identifiers: MetadataValue<{ label: string; value: string }[]>;
  tags: MetadataValue<string[]>;
}

export interface DocumentIntelligence {
  id: string;
  documentId: string;
  versionId: string;
  disclaimer: string;
  processing: { status: ProcessingStatus; error: string | null; attempts: number; queuedAt: string; startedAt: string | null; completedAt: string | null };
  extraction: {
    status: ExtractionStatus;
    textSource: "TEXT_LAYER" | "OCR" | "NONE" | null;
    provider: string | null;
    confidence: number | null;
    language: string | null;
    pageCount: number | null;
    characterCount: number | null;
    limitations: string[];
    error: string | null;
    textPreview: string | null;
    textTruncated: boolean;
    masked: true;
  };
  pii: { status: StepStatus; findingCount: number | null; typeCounts: Record<string, number> };
  classification: {
    status: StepStatus;
    reason: string | null;
    suggestedType: string | null;
    confidence: number | null;
    provider: string | null;
    review: ReviewStatus;
    provenance: AiProvenance | null;
    confirmedType: string | null;
    reviewedBy: string | null;
    reviewedAt: string | null;
  };
  metadata: {
    status: StepStatus;
    reason: string | null;
    extracted: StructuredDocumentMetadata | null;
    provider: string | null;
    review: ReviewStatus;
    provenance: AiProvenance | null;
    confirmed: Partial<StructuredDocumentMetadata> | null;
    reviewedBy: string | null;
    reviewedAt: string | null;
  };
  summary: { status: StepStatus; reason: string | null; text: string | null; provider: string | null; generatedAt: string | null; provenance: "AI_GENERATED" | null };
  index: { status: StepStatus; indexedAt: string | null };
  jobs: { id: string; status: string; attempt: number; createdAt: string; completedAt: string | null; error: string | null }[];
}

export interface DocumentIntelligenceResponse {
  document: { id: string; title: string; type: string; confidentiality: Confidentiality; versionNumber: number };
  intelligence: DocumentIntelligence | null;
  policy: { restricted: boolean; restrictedReason: string | null; aiProvider: string; ocrProvider: string };
  capabilities: { canReprocess: boolean; canReview: boolean; canApplyType: boolean };
}

export type SearchMatchSource = "title" | "number" | "tags" | "metadata" | "text" | "semantic";

export interface DocumentSearchHit {
  documentId: string;
  documentNumber: string;
  title: string;
  caseId: string;
  caseNumber: string;
  type: string;
  suggestedType: string | null;
  confirmedType: string | null;
  confidentiality: Confidentiality;
  processingStatus: ProcessingStatus | null;
  createdAt: string;
  documentDate: string | null;
  snippet: string | null;
  summary: string | null;
  score: number;
  matchedOn: SearchMatchSource[];
}

export interface DocumentSearchResponse {
  mode: "keyword" | "intelligent";
  total: number;
  results: DocumentSearchHit[];
  interpretation:
    | { keywords: string[]; documentTypes: string[]; caseNumbers: string[]; evidenceNumbers: string[]; dateFrom?: string; dateTo?: string; fallback: boolean }
    | null;
  ranking: { keyword: string; semanticProvider: string | null; semanticError: string | null };
  tookMs: number;
}
