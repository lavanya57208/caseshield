export interface CurrentUser {
  id: string;
  employeeId: string;
  name: string;
  email: string;
  role: string;
  department: string;
}

export interface CaseRow {
  id: string;
  case_number: string;
  title: string;
  status: string;
  priority: string;
  summary?: string;
  category_name?: string;
  category_id?: string;
  case_type_name?: string;
  court_name?: string;
  court_type?: string;
  investigator_name?: string;
  created_by_name?: string;
  document_count?: number;
  evidence_count?: number;
  pendingRequests?: number;
  created_at?: string;
  updated_at?: string;
  stakeholders?: { id: string; name: string; role: string; department: string; roleInCase: string }[];
}

export interface DocumentRow {
  id: string;
  document_number: string;
  filename: string;
  document_type: string;
  description?: string;
  confidentiality_level: string;
  access_level: string;
  tags: string[];
  current_version: number;
  status: string;
  uploaded_by_name?: string;
  created_at: string;
  updated_at: string;
  version_count?: number;
  versions?: any[];
  signatures?: any[];
}

export interface EvidenceRow {
  id: string;
  evidence_code: string;
  evidence_type: string;
  description: string;
  collected_by_name?: string;
  custodian_name?: string;
  integrity_status: string;
  chain_status: string;
  custody_event_count?: number;
  created_at: string;
}

export interface AccessRequestRow {
  id: string;
  requester_name: string;
  role: string;
  resource_type: string;
  resource_label: string;
  permission: string;
  reason: string;
  requested_at: string;
  expiry?: string;
  status: string;
  reviewer_name?: string;
}

export interface AuditEventRow {
  id: string;
  timestamp: string;
  actor: string;
  role?: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  caseNumber?: string;
  caseId?: string;
  result: string;
  metadata?: Record<string, unknown>;
}
