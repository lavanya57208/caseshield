import { api } from "../../api.js";
import { icon } from "../../components/icons.js";
import { badge } from "../../components/badge.js";
import { escapeHtml, formatDateTime, timeAgo } from "../../util.js";

export async function renderOverview(content: HTMLElement, c: any) {
  const activity = await api.get<any[]>(`/cases/${c.id}/activity`);

  content.innerHTML = `
    <div class="grid grid-2" style="align-items:start;">
      <div>
        <div class="card">
          <div class="card-title">Case Summary</div>
          <p style="font-size:13px;color:var(--text);line-height:1.6;">${escapeHtml(c.summary || "No summary has been recorded for this case yet.")}</p>
        </div>

        <div class="card">
          <div class="card-title">Case Activity</div>
          ${
            activity.length
              ? `<div class="table-wrap"><table class="data-table"><tbody>${activity
                  .map(
                    (a: any) => `
                <tr>
                  <td style="width:30%;">${escapeHtml(a.actor)}</td>
                  <td>${escapeHtml(a.action)}</td>
                  <td>${badge(a.result)}</td>
                  <td class="muted" style="text-align:right;">${timeAgo(a.timestamp)}</td>
                </tr>`
                  )
                  .join("")}</tbody></table></div>`
              : `<div class="muted" style="padding:12px 0;">No activity recorded for this case yet.</div>`
          }
        </div>
      </div>

      <div>
        <div class="card">
          <div class="card-title">Authorized Stakeholders</div>
          <div style="display:flex;flex-direction:column;gap:10px;">
            ${
              (c.stakeholders || []).length
                ? c.stakeholders
                    .map(
                      (s: any) => `
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <div>
                  <div style="font-weight:600;font-size:12.5px;">${escapeHtml(s.name)}</div>
                  <div class="muted" style="font-size:11.5px;">${escapeHtml(s.role)}</div>
                </div>
                <span class="badge badge-gray">${escapeHtml(s.roleInCase)}</span>
              </div>`
                    )
                    .join("")
                : `<div class="muted" style="font-size:12.5px;">No additional stakeholders recorded.</div>`
            }
          </div>
        </div>

        <div class="card">
          <div class="card-title">Security &amp; Integrity Status</div>
          <div class="kv-list">
            <div class="kv"><span class="k">Access control</span><span class="v">${icon("lock", 13)} Enforced</span></div>
            <div class="kv"><span class="k">Document integrity</span><span class="v">${icon("checkShield", 13)} Monitoring active</span></div>
            <div class="kv"><span class="k">Audit trail</span><span class="v">${icon("audit", 13)} Recording</span></div>
            <div class="kv"><span class="k">Pending access requests</span><span class="v">${c.pendingRequests}</span></div>
          </div>
        </div>
      </div>
    </div>
  `;
}
