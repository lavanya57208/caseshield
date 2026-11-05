import { api } from "../api.js";
import { getUser, initials } from "../state.js";
import { icon } from "../components/icons.js";
import { escapeHtml, formatDateTime } from "../util.js";

export async function renderProfile(content: HTMLElement) {
  const me = await api.get<any>("/auth/me");
  const user = getUser();

  content.innerHTML = `
    <div class="page-header"><div><h1>Profile</h1><div class="sub">Your account details and security activity.</div></div></div>
    <div class="grid grid-2" style="align-items:start;">
      <div class="card">
        <div style="display:flex;align-items:center;gap:16px;margin-bottom:18px;">
          <div class="avatar" style="width:56px;height:56px;font-size:18px;">${initials(me.name)}</div>
          <div>
            <div style="font-size:16px;font-weight:650;color:var(--navy);">${escapeHtml(me.name)}</div>
            <div class="muted">${escapeHtml(me.role)} · ${escapeHtml(me.department || "")}</div>
          </div>
        </div>
        <div class="kv-list">
          <div class="kv"><span class="k">Employee ID</span><span class="v mono">${escapeHtml(me.employeeId)}</span></div>
          <div class="kv"><span class="k">Email</span><span class="v">${escapeHtml(me.email)}</span></div>
          <div class="kv"><span class="k">Role</span><span class="v">${escapeHtml(me.role)}</span></div>
          <div class="kv"><span class="k">Department</span><span class="v">${escapeHtml(me.department || "—")}</span></div>
          <div class="kv"><span class="k">Last login</span><span class="v">${formatDateTime(me.lastLoginAt)}</span></div>
        </div>
      </div>
      <div class="card">
        <div class="card-title">Security</div>
        <div class="kv-list">
          <div class="kv"><span class="k">${icon("lock", 13)} Multi-factor authentication</span><span class="v">Integration ready</span></div>
          <div class="kv"><span class="k">${icon("shield", 13)} Session management</span><span class="v">Active (8h expiry)</span></div>
          <div class="kv"><span class="k">${icon("audit", 13)} Security activity</span><span class="v">Logged to Audit Trail</span></div>
        </div>
        <p class="muted" style="font-size:11.5px;margin-top:14px;">This prototype authenticates with a signed session token. Production deployments should connect Google Identity Platform (or an equivalent identity provider) with MFA enabled.</p>
      </div>
    </div>
  `;
}
