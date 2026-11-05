import { api } from "../api.js";
import { getUser } from "../state.js";
import { icon } from "../components/icons.js";
import { badge, priorityBadge } from "../components/badge.js";
import { escapeHtml, formatDate, timeAgo } from "../util.js";
import { navigate } from "../router.js";

const SECURITY_ICON: Record<string, Parameters<typeof icon>[0]> = {
  authentication: "lock",
  storage: "folder",
  documentIntegrity: "checkShield",
  auditLogging: "audit",
};
const SECURITY_LABEL: Record<string, string> = {
  authentication: "Authentication",
  storage: "Storage",
  documentIntegrity: "Document Integrity",
  auditLogging: "Audit Logging",
};

export async function renderDashboard(content: HTMLElement) {
  const user = getUser();
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  const summary = await api.get<any>("/dashboard/summary");

  content.innerHTML = `
    <div class="page-header">
      <div>
        <h1>${greeting}, ${escapeHtml(user?.name?.split(" ")[0] || "")}</h1>
        <div class="sub">${escapeHtml(user?.role || "")} · ${escapeHtml(user?.department || "")}</div>
      </div>
    </div>

    <div class="grid grid-4" style="margin-bottom:20px;">
      ${statCard("Active Cases", summary.activeCases, "cases", "#E1F1EF", "#0F766E")}
      ${statCard("Total Documents", summary.totalDocuments, "fileText", "#E7ECF1", "#0B1F33")}
      ${statCard("Evidence Items", summary.evidenceItems, "folder", "#FBF0DE", "#B7791F")}
      ${statCard("Pending Access Requests", summary.pendingAccessRequests, "clipboard", "#FBEAE9", "#B42318")}
    </div>

    <div class="grid grid-2" style="align-items:start;">
      <div>
        <div class="card">
          <div class="card-title">Recent Cases</div>
          ${
            summary.recentCases.length
              ? summary.recentCases
                  .map(
                    (c: any) => `
              <div class="kv" style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px dashed var(--border);cursor:pointer;" data-case="${c.id}">
                <div>
                  <div style="font-weight:600;font-size:13px;">${escapeHtml(c.title)}</div>
                  <div class="muted mono" style="font-size:11.5px;color:var(--text-muted);">${escapeHtml(c.caseNumber)} · ${escapeHtml(c.category)}</div>
                </div>
                <div style="display:flex;gap:6px;align-items:center;">${priorityBadge(c.priority)}${badge(c.status)}</div>
              </div>`
                  )
                  .join("")
              : emptyRow("No cases yet.")
          }
        </div>

        <div class="card">
          <div class="card-title">Recent Activity</div>
          ${
            summary.recentActivity.length
              ? `<div class="table-wrap"><table class="data-table"><tbody>${summary.recentActivity
                  .map(
                    (a: any) => `
                <tr><td style="width:36%;">${escapeHtml(a.actor)}</td><td>${escapeHtml(a.action)}</td>
                <td class="muted" style="text-align:right;">${timeAgo(a.timestamp)}</td></tr>`
                  )
                  .join("")}</tbody></table></div>`
              : emptyRow("No recent activity.")
          }
        </div>

        <div class="card">
          <div class="card-title">Security Alerts</div>
          ${summary.securityAlerts
            .map(
              (al: any) =>
                `<div class="banner ${al.level === "warning" ? "banner-warning" : "banner-info"}">${icon(al.level === "warning" ? "alertTriangle" : "checkCircle", 15)} ${escapeHtml(al.message)}</div>`
            )
            .join("")}
        </div>
      </div>

      <div>
        <div class="card">
          <div class="card-title">Security Overview</div>
          <div style="display:flex;flex-direction:column;gap:10px;">
            ${Object.entries(summary.security)
              .map(
                ([k, v]) => `
              <div class="security-tile">
                <div class="swatch" style="background:#E1F1EF;color:#0F766E;">${icon(SECURITY_ICON[k] || "shield", 18)}</div>
                <div>
                  <div class="name">${SECURITY_LABEL[k] || k}</div>
                  <div class="status">${escapeHtml(String(v))}</div>
                </div>
              </div>`
              )
              .join("")}
          </div>
        </div>

        <div class="card">
          <div class="card-title">Pending Access Requests</div>
          ${
            summary.pendingRequests.length
              ? summary.pendingRequests
                  .map(
                    (r: any) => `
              <div style="padding:10px 0;border-bottom:1px dashed var(--border);cursor:pointer;" data-req-case="${r.caseId}">
                <div style="font-weight:600;font-size:12.5px;">${escapeHtml(r.resourceLabel)}</div>
                <div class="muted" style="font-size:11.5px;margin-top:2px;">${escapeHtml(r.requesterName)} requested ${escapeHtml(r.permission)} · ${escapeHtml(r.caseNumber)}</div>
              </div>`
                  )
                  .join("")
              : emptyRow("Nothing pending review.")
          }
        </div>

        <div class="card">
          <div class="card-title">Quick Actions</div>
          <div style="display:flex;flex-direction:column;gap:8px;">
            <a class="btn btn-ghost" href="/cases" style="justify-content:flex-start;">${icon("cases", 16)} Open Cases</a>
            <a class="btn btn-ghost" href="/cases" style="justify-content:flex-start;">${icon("upload", 16)} Upload Document</a>
            <a class="btn btn-ghost" href="/cases" style="justify-content:flex-start;">${icon("clipboard", 16)} Review Access Requests</a>
            <a class="btn btn-ghost" href="/search" style="justify-content:flex-start;">${icon("search", 16)} Search Documents</a>
          </div>
        </div>
      </div>
    </div>
  `;

  content.querySelectorAll<HTMLElement>("[data-case]").forEach((el) => {
    el.addEventListener("click", () => navigate(`/cases/${el.dataset.case}`));
  });
  content.querySelectorAll<HTMLElement>("[data-req-case]").forEach((el) => {
    el.addEventListener("click", () => navigate(`/cases/${el.dataset.reqCase}/access-requests`));
  });
}

function statCard(label: string, value: number, iconName: Parameters<typeof icon>[0], bg: string, fg: string) {
  return `
    <div class="stat-card">
      <div class="icon" style="background:${bg};color:${fg};">${icon(iconName, 18)}</div>
      <div class="label">${label}</div>
      <div class="value">${value}</div>
    </div>`;
}

function emptyRow(text: string) {
  return `<div class="muted" style="padding:16px 0;color:var(--text-muted);font-size:12.5px;">${text}</div>`;
}
