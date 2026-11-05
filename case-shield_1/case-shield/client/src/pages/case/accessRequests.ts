import { api, ApiError } from "../../api.js";
import { icon } from "../../components/icons.js";
import { badge } from "../../components/badge.js";
import { escapeHtml, formatDate } from "../../util.js";
import { toast } from "../../util.js";
import { getUser } from "../../state.js";

export async function renderAccessRequests(content: HTMLElement, c: any) {
  const requests = await api.get<any[]>(`/access-requests/case/${c.id}`);
  const user = getUser();

  const render = () => {
    content.innerHTML = `
      <div class="card" style="padding:0;">
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr>
              <th>Requester</th><th>Role</th><th>Resource</th><th>Permission</th><th>Reason</th><th>Requested</th><th>Status</th><th></th>
            </tr></thead>
            <tbody>
              ${
                requests.length
                  ? requests
                      .map(
                        (r: any) => `
                <tr>
                  <td style="font-weight:600;">${escapeHtml(r.requester_name)}</td>
                  <td class="muted">${escapeHtml(r.role)}</td>
                  <td>${escapeHtml(r.resource_label)}</td>
                  <td>${escapeHtml(r.permission)}</td>
                  <td class="muted" style="max-width:220px;">${escapeHtml(r.reason)}</td>
                  <td class="muted">${formatDate(r.requested_at)}</td>
                  <td>${badge(r.status)}</td>
                  <td>
                    ${
                      r.status === "Pending"
                        ? `<div class="action-row">
                          <button class="btn btn-ghost btn-sm" data-approve="${r.id}">${icon("checkCircle", 13)} Approve</button>
                          <button class="btn btn-danger btn-sm" data-reject="${r.id}">${icon("x", 13)} Reject</button>
                        </div>`
                        : r.status === "Approved"
                          ? `<button class="btn btn-ghost btn-sm" data-revoke="${r.id}">Revoke</button>`
                          : ""
                    }
                  </td>
                </tr>`
                      )
                      .join("")
                  : `<tr><td colspan="8"><div class="empty-state">${icon("clipboard", 28)}<div class="title">No access requests for this case</div></div></td></tr>`
              }
            </tbody>
          </table>
        </div>
      </div>
    `;

    content.querySelectorAll<HTMLElement>("[data-approve]").forEach((btn) =>
      btn.addEventListener("click", () => act(btn.dataset.approve!, "approve"))
    );
    content.querySelectorAll<HTMLElement>("[data-reject]").forEach((btn) =>
      btn.addEventListener("click", () => act(btn.dataset.reject!, "reject"))
    );
    content.querySelectorAll<HTMLElement>("[data-revoke]").forEach((btn) =>
      btn.addEventListener("click", () => act(btn.dataset.revoke!, "revoke"))
    );
  };

  async function act(id: string, action: "approve" | "reject" | "revoke") {
    try {
      await api.post(`/access-requests/${id}/${action}`);
      toast(`Request ${action === "approve" ? "approved" : action === "reject" ? "rejected" : "revoked"}.`, "success");
      const fresh = await api.get<any[]>(`/access-requests/case/${c.id}`);
      requests.length = 0;
      requests.push(...fresh);
      render();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Action failed — you may not have permission to review requests.", "error");
    }
  }

  render();
}
