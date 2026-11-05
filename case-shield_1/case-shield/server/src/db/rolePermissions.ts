import { Role, ResourceType, Action } from "../lib/permissions";

/**
 * Default (coarse-grained) role -> action grants. Seeded verbatim into the
 * role_permissions table. Case-, document- and evidence-level checks in
 * lib/permissions.ts layer case membership and explicit grants on top of
 * this table - a role default alone is never sufficient for a specific
 * case's data.
 */
export const ROLE_PERMISSIONS: Record<Role, Array<[ResourceType, Action]>> = {
  Investigator: [
    ["case", "view"],
    ["document", "view"],
    ["document", "download"],
    ["document", "upload"],
    ["document", "verify_integrity"],
    ["evidence", "view"],
    ["evidence", "upload"],
    ["evidence", "edit_metadata"],
    ["custody", "view"],
    ["custody", "upload"],
    ["access_request", "view"],
    ["access_request", "create"],
    ["audit", "view"],
  ],
  "Senior Investigator": [
    ["case", "view"],
    ["case", "edit_metadata"],
    ["document", "view"],
    ["document", "download"],
    ["document", "upload"],
    ["document", "edit_metadata"],
    ["document", "verify_integrity"],
    ["evidence", "view"],
    ["evidence", "upload"],
    ["evidence", "edit_metadata"],
    ["custody", "view"],
    ["custody", "upload"],
    ["access_request", "view"],
    ["access_request", "create"],
    ["access_request", "approve"],
    ["access_request", "revoke"],
    ["audit", "view"],
  ],
  "Forensic Officer": [
    ["case", "view"],
    ["document", "view"],
    ["document", "download"],
    ["document", "upload"],
    ["document", "verify_integrity"],
    ["evidence", "view"],
    ["evidence", "upload"],
    ["evidence", "edit_metadata"],
    ["evidence", "verify_integrity"],
    ["custody", "view"],
    ["custody", "upload"],
    ["access_request", "view"],
    ["access_request", "create"],
    ["audit", "view"],
  ],
  Prosecutor: [
    ["case", "view"],
    ["document", "view"],
    ["document", "download"],
    ["evidence", "view"],
    ["custody", "view"],
    ["access_request", "view"],
    ["access_request", "create"],
    ["audit", "view"],
  ],
  Judge: [
    ["case", "view"],
    ["document", "view"],
    ["document", "download"],
    ["evidence", "view"],
    ["custody", "view"],
    ["access_request", "view"],
    ["audit", "view"],
  ],
  Lawyer: [
    ["case", "view"],
    ["document", "view"],
    ["document", "download"],
    ["access_request", "view"],
    ["access_request", "create"],
  ],
  "Court Staff": [
    ["case", "view"],
    ["document", "view"],
    ["document", "upload"],
    ["access_request", "view"],
    ["access_request", "create"],
  ],
  Litigant: [
    ["case", "view"],
    ["document", "view"],
    ["access_request", "view"],
    ["access_request", "create"],
  ],
  "System Administrator": [
    ["system", "manage"],
    ["system", "view"],
    ["case", "view"],
    ["access_request", "view"],
    ["access_request", "approve"],
    ["access_request", "revoke"],
    ["audit", "view"],
    // Deliberately no document/evidence content grants by default.
  ],
  Auditor: [
    ["audit", "view"],
    ["case", "view"],
    ["access_request", "view"],
    // Deliberately no document/evidence content grants by default - an
    // auditor sees that activity happened, not the document content itself,
    // unless a case explicitly grants it.
  ],
};
