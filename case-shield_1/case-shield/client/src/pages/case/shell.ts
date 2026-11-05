import { api } from "../../api.js";
import { icon } from "../../components/icons.js";
import { badge, priorityBadge } from "../../components/badge.js";
import { escapeHtml, formatDate } from "../../util.js";
import { renderOverview } from "./overview.js";
import { renderDocuments } from "./documents.js";
import { renderEvidence } from "./evidence.js";
import { renderAuditTrail } from "./auditTrail.js";
import { renderAccessRequests } from "./accessRequests.js";

export type CaseTab = "overview" | "documents" | "evidence" | "chain-of-custody" | "audit-trail" | "access-requests";

const TABS: { id: CaseTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "documents", label: "Documents" },
  { id: "evidence", label: "Evidence" },
  { id: "chain-of-custody", label: "Chain of Custody" },
  { id: "audit-trail", label: "Audit Trail" },
  { id: "access-requests", label: "Access Requests" },
];

export async function renderCaseDetail(content: HTMLElement, caseId: string, tab: CaseTab, setTitle: (t: string) => void) {
  const c = await api.get<any>(`/cases/${caseId}`);
  setTitle(c.title);

  content.innerHTML = `
    <div class="case-header">
      <div class="breadcrumb"><a href="/cases">Cases</a> / <a href="/cases?category=${c.category_id}">${escapeHtml(c.category_name)}</a> / ${escapeHtml(c.case_number)}</div>
      <div class="titlerow">
        <h1>${escapeHtml(c.title)}</h1>
        ${priorityBadge(c.priority)}
        ${badge(c.status)}
      </div>
      <div class="case-number">${escapeHtml(c.case_number)} · ${escapeHtml(c.case_type_name)} · ${escapeHtml(c.court_name)}</div>
      <div class="case-meta">
        <div class="item"><div class="k">Investigator</div><div class="v">${escapeHtml(c.investigator_name || "Unassigned")}</div></div>
        <div class="item"><div class="k">Created</div><div class="v">${formatDate(c.created_at)}</div></div>
        <div class="item"><div class="k">Last Updated</div><div class="v">${formatDate(c.updated_at)}</div></div>
        <div class="item"><div class="k">Documents</div><div class="v">${c.documentCount}</div></div>
        <div class="item"><div class="k">Evidence</div><div class="v">${c.evidenceCount}</div></div>
        <div class="item"><div class="k">Pending Requests</div><div class="v">${c.pendingRequests}</div></div>
      </div>
    </div>

    <div class="tabs">
      ${TABS.map((t) => `<a href="/cases/${caseId}/${t.id}" class="${t.id === tab ? "active" : ""}">${escapeHtml(t.label)}</a>`).join("")}
    </div>

    <div data-el="tab-content"><div class="loading-state">Loading…</div></div>
  `;

  const tabContent = content.querySelector<HTMLElement>('[data-el="tab-content"]')!;

  switch (tab) {
    case "overview":
      await renderOverview(tabContent, c);
      break;
    case "documents":
      await renderDocuments(tabContent, c);
      break;
    case "evidence":
      await renderEvidence(tabContent, c, false);
      break;
    case "chain-of-custody":
      await renderEvidence(tabContent, c, true);
      break;
    case "audit-trail":
      await renderAuditTrail(tabContent, c);
      break;
    case "access-requests":
      await renderAccessRequests(tabContent, c);
      break;
  }
}
