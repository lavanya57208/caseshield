import { api } from "../../api.js";
import { badge } from "../../components/badge.js";
import { escapeHtml, formatDateTime } from "../../util.js";

export async function renderAuditTrail(content: HTMLElement, c: any) {
  const events = await api.get<any[]>(`/audit/case/${c.id}`);

  content.innerHTML = `
    <div class="card" style="padding:0;">
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Timestamp</th><th>Actor</th><th>Role</th><th>Action</th><th>Resource</th><th>Result</th></tr></thead>
          <tbody>
            ${
              events.length
                ? events
                    .map(
                      (e: any) => `
              <tr>
                <td class="mono muted">${formatDateTime(e.timestamp)}</td>
                <td>${escapeHtml(e.actor)}</td>
                <td class="muted">${escapeHtml(e.role || "—")}</td>
                <td>${escapeHtml(e.action)}</td>
                <td class="muted">${escapeHtml(e.resourceType || "—")}</td>
                <td>${badge(e.result)}</td>
              </tr>`
                    )
                    .join("")
                : `<tr><td colspan="6"><div class="empty-state"><div class="title">No audit events for this case yet</div></div></td></tr>`
            }
          </tbody>
        </table>
      </div>
    </div>
  `;
}
