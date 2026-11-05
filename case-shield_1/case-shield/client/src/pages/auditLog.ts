import { api, ApiError } from "../api.js";
import { icon } from "../components/icons.js";
import { badge } from "../components/badge.js";
import { escapeHtml, formatDateTime } from "../util.js";
import { navigate } from "../router.js";

export async function renderAuditLog(content: HTMLElement, _params: Record<string, string>, query: URLSearchParams) {
  const action = query.get("action") || "";
  const result = query.get("result") || "";
  const q = query.get("q") || "";

  content.innerHTML = `
    <div class="page-header">
      <div>
        <h1>System Audit Log</h1>
        <div class="sub">Global, tamper-evident record of every privileged action across the system.</div>
      </div>
      <button class="btn btn-ghost btn-sm" type="button" data-action="verify-chain">${icon("checkShield", 14)} Verify Audit Chain</button>
    </div>
    <div data-el="chain-result"></div>
    <form class="toolbar" data-el="filters">
      <input type="search" name="q" placeholder="Search action, resource, case…" value="${escapeHtml(q)}" style="min-width:220px;" />
      <select name="action">
        <option value="">All actions</option>
        ${["Login","Logout","Failed Login","Case Created","Case Viewed","Document Uploaded","Document Viewed","Document Downloaded","Document Version Created","Access Requested","Access Approved","Access Rejected","Access Revoked","Integrity Verified","Integrity Violation","Evidence Transferred"]
          .map((a) => `<option value="${a}" ${a === action ? "selected" : ""}>${a}</option>`)
          .join("")}
      </select>
      <select name="result">
        <option value="">All results</option>
        <option value="Success" ${result === "Success" ? "selected" : ""}>Success</option>
        <option value="Failure" ${result === "Failure" ? "selected" : ""}>Failure</option>
        <option value="Denied" ${result === "Denied" ? "selected" : ""}>Denied</option>
      </select>
      <button class="btn btn-ghost btn-sm" type="submit">${icon("filter", 13)} Apply</button>
    </form>
    <div data-el="table"><div class="loading-state">Loading…</div></div>
  `;

  content.querySelector('[data-action="verify-chain"]')!.addEventListener("click", async () => {
    const target = content.querySelector<HTMLElement>('[data-el="chain-result"]')!;
    target.innerHTML = `<div class="loading-state">Verifying chain…</div>`;
    try {
      const res = await api.get<any>("/audit/verify-chain");
      const ok = res.status === "AUDIT CHAIN VERIFIED";
      target.innerHTML = `<div class="banner ${ok ? "banner-success" : "banner-warning"}">${icon(ok ? "checkCircle" : "alertTriangle", 15)} ${res.status} — ${res.checkedEvents} events checked. ${escapeHtml(res.note)}</div>`;
    } catch (err) {
      target.innerHTML = `<div class="banner banner-warning">${err instanceof ApiError ? escapeHtml(err.message) : "Could not verify chain."}</div>`;
    }
  });

  const form = content.querySelector<HTMLFormElement>('[data-el="filters"]')!;
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const params = new URLSearchParams();
    for (const key of ["q", "action", "result"]) {
      const v = String(fd.get(key) || "");
      if (v) params.set(key, v);
    }
    navigate(`/audit-log?${params.toString()}`);
  });

  const table = content.querySelector<HTMLElement>('[data-el="table"]')!;
  try {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (action) params.set("action", action);
    if (result) params.set("result", result);
    const events = await api.get<any[]>(`/audit/system?${params.toString()}`);

    table.innerHTML = `
      <div class="card" style="padding:0;">
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Timestamp</th><th>User</th><th>Role</th><th>Action</th><th>Resource</th><th>Case</th><th>Result</th></tr></thead>
            <tbody>
              ${
                events.length
                  ? events
                      .map(
                        (e: any) => `
                <tr class="${e.caseId ? "clickable" : ""}" ${e.caseId ? `data-case="${e.caseId}"` : ""}>
                  <td class="mono muted">${formatDateTime(e.timestamp)}</td>
                  <td>${escapeHtml(e.actor)}</td>
                  <td class="muted">${escapeHtml(e.role || "—")}</td>
                  <td>${escapeHtml(e.action)}</td>
                  <td class="muted">${escapeHtml(e.resourceType || "—")}</td>
                  <td class="mono muted">${escapeHtml(e.caseNumber || "—")}</td>
                  <td>${badge(e.result)}</td>
                </tr>`
                      )
                      .join("")
                  : `<tr><td colspan="7"><div class="empty-state"><div class="title">No matching audit events</div></div></td></tr>`
              }
            </tbody>
          </table>
        </div>
      </div>
    `;
    table.querySelectorAll<HTMLElement>("[data-case]").forEach((el) => {
      el.addEventListener("click", () => navigate(`/cases/${el.dataset.case}`));
    });
  } catch (err) {
    table.innerHTML = `<div class="banner banner-warning">${err instanceof ApiError ? escapeHtml(err.message) : "You are not authorized to view the system audit log."}</div>`;
  }
}
