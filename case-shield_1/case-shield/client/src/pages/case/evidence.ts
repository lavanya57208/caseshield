import { api, ApiError } from "../../api.js";
import { icon } from "../../components/icons.js";
import { badge } from "../../components/badge.js";
import { openModal } from "../../components/modal.js";
import { escapeHtml, formatDate, formatDateTime, toast } from "../../util.js";

const CUSTODY_ACTIONS = ["Collected", "Transferred", "Received", "Examined", "Verified", "Submitted", "Released", "Archived"];

export async function renderEvidence(content: HTMLElement, c: any, focusCustody: boolean) {
  const items = await api.get<any[]>(`/evidence/case/${c.id}`);

  content.innerHTML = `
    <div class="toolbar" style="justify-content:space-between;">
      <div class="sub" style="font-size:12.5px;color:var(--text-muted);">${items.length} evidence item${items.length === 1 ? "" : "s"}${focusCustody ? " — select an item to view its chain of custody" : ""}</div>
    </div>
    <div class="grid grid-3" data-el="evidence-grid">
      ${
        items.length
          ? items
              .map(
                (ev: any) => `
          <div class="card" style="cursor:pointer;" data-ev="${ev.id}">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;">
              <div>
                <div style="font-weight:650;font-size:13.5px;">${escapeHtml(ev.evidence_code)}</div>
                <div class="muted" style="font-size:12px;margin-top:2px;">${escapeHtml(ev.evidence_type)}</div>
              </div>
              ${badge(ev.integrity_status, ev.integrity_status === "Verified" ? "green" : "amber")}
            </div>
            <p style="font-size:12.5px;color:var(--text);margin:10px 0;">${escapeHtml(ev.description)}</p>
            <div class="kv-list">
              <div class="kv"><span class="k">Custodian</span><span class="v">${escapeHtml(ev.custodian_name || "—")}</span></div>
              <div class="kv"><span class="k">Chain status</span><span class="v">${badge(ev.chain_status, "gray")}</span></div>
              <div class="kv"><span class="k">Custody events</span><span class="v">${ev.custody_event_count ?? 0}</span></div>
            </div>
          </div>`
              )
              .join("")
          : `<div class="empty-state">${icon("folder", 28)}<div class="title">No evidence recorded</div></div>`
      }
    </div>
    <div data-el="custody-panel" style="margin-top:20px;"></div>
  `;

  const panel = content.querySelector<HTMLElement>('[data-el="custody-panel"]')!;

  content.querySelectorAll<HTMLElement>("[data-ev]").forEach((el) => {
    el.addEventListener("click", () => loadCustody(el.dataset.ev!, ev(items, el.dataset.ev!)));
  });

  function ev(list: any[], id: string) {
    return list.find((x) => x.id === id);
  }

  async function loadCustody(evidenceId: string, evRow: any) {
    panel.innerHTML = `<div class="loading-state">Loading chain of custody…</div>`;
    panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    try {
      const data = await api.get<any>(`/evidence/${evidenceId}/custody`);
      panel.innerHTML = `
        <div class="card">
          <div class="card-title">
            <span>Chain of Custody — ${escapeHtml(evRow?.evidence_code || "")}</span>
            <button class="btn btn-ghost btn-sm" type="button" data-action="transfer">${icon("share", 14)} Record Custody Event</button>
          </div>
          <div class="timeline">
            ${data.events
              .map(
                (e: any) => `
              <div class="timeline-item">
                <span class="timeline-dot"></span>
                <div class="row">
                  <span class="action">${escapeHtml(e.action)}</span>
                  ${badge(e.status, "gray")}
                </div>
                <div class="meta">${escapeHtml(e.from_name || "Intake")} (${escapeHtml(e.from_role || "—")}) &rarr; ${escapeHtml(e.to_name)} (${escapeHtml(e.to_role)}) · ${formatDateTime(e.event_timestamp)}</div>
                ${e.reason ? `<div class="reason">${escapeHtml(e.reason)}</div>` : ""}
              </div>`
              )
              .join("")}
          </div>
        </div>
      `;
      panel.querySelector('[data-action="transfer"]')!.addEventListener("click", () => openTransferModal(c, evidenceId, evRow, () => loadCustody(evidenceId, evRow)));
    } catch (err) {
      panel.innerHTML = `<div class="banner banner-warning">${err instanceof ApiError ? escapeHtml(err.message) : "Could not load chain of custody."}</div>`;
    }
  }

  if (focusCustody && items.length) {
    loadCustody(items[0].id, items[0]);
  }
}

async function openTransferModal(c: any, evidenceId: string, evRow: any, onDone: () => void) {
  const people = await api.get<any[]>("/users/directory");
  const { el, close } = openModal(
    "Record Custody Event",
    `
    <form data-el="form">
      <div class="field">
        <label>Action</label>
        <select name="action">${CUSTODY_ACTIONS.map((a) => `<option value="${a}">${a}</option>`).join("")}</select>
      </div>
      <div class="field">
        <label>Transfer to</label>
        <select name="toPersonId">${people.map((p: any) => `<option value="${p.id}">${escapeHtml(p.name)} — ${escapeHtml(p.role)}</option>`).join("")}</select>
      </div>
      <div class="field">
        <label>Reason</label>
        <textarea name="reason" rows="3" placeholder="Reason for this custody event"></textarea>
      </div>
      <div data-el="error"></div>
    </form>
  `,
    `<button class="btn btn-ghost" type="button" data-el="cancel">Cancel</button>
     <button class="btn btn-primary" type="button" data-el="submit">Save</button>`
  );
  el.querySelector('[data-el="cancel"]')!.addEventListener("click", close);
  el.querySelector('[data-el="submit"]')!.addEventListener("click", async () => {
    const form = el.querySelector<HTMLFormElement>('[data-el="form"]')!;
    const fd = new FormData(form);
    try {
      await api.post(`/evidence/${evidenceId}/custody`, {
        action: fd.get("action"),
        toPersonId: fd.get("toPersonId"),
        reason: fd.get("reason"),
      });
      toast("Custody event recorded.", "success");
      close();
      onDone();
    } catch (err) {
      el.querySelector('[data-el="error"]')!.innerHTML = `<div class="form-error">${err instanceof ApiError ? escapeHtml(err.message) : "Could not record event."}</div>`;
    }
  });
}
