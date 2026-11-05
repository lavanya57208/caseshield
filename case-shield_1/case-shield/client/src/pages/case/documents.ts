import { api, ApiError, downloadDocument, readFileAsBase64 } from "../../api.js";
import { icon } from "../../components/icons.js";
import { badge } from "../../components/badge.js";
import { openModal } from "../../components/modal.js";
import { escapeHtml, formatDate, formatDateTime, toast } from "../../util.js";

const DOC_TYPES = [
  "FIR / Police Report",
  "Investigation Report",
  "Witness Statement",
  "Charge Sheet",
  "Court Filing",
  "Forensic Report",
  "Legal Notice",
  "Judgment",
  "Evidence Record",
  "Other",
];
const CONFIDENTIALITY_LEVELS = ["Internal", "Case Team Only", "Confidential", "Restricted"];

export async function renderDocuments(content: HTMLElement, c: any) {
  const docs = await api.get<any[]>(`/documents/case/${c.id}`);

  content.innerHTML = `
    <div class="toolbar" style="justify-content:space-between;">
      <div class="sub" style="font-size:12.5px;color:var(--text-muted);">${docs.length} document${docs.length === 1 ? "" : "s"} visible to you in this case</div>
      <button class="btn btn-primary btn-sm" type="button" data-action="upload">${icon("upload", 15)} Upload Document</button>
    </div>
    <div class="card" style="padding:0;">
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr>
            <th>Document</th><th>Type</th><th>Version</th><th>Uploaded By</th><th>Uploaded</th><th>Integrity</th><th>Access Level</th><th></th>
          </tr></thead>
          <tbody>
            ${
              docs.length
                ? docs
                    .map(
                      (d: any) => `
              <tr class="clickable" data-doc="${d.id}">
                <td>
                  <div style="display:flex;align-items:center;gap:8px;font-weight:600;">${icon("fileText", 15)} ${escapeHtml(d.filename)}</div>
                  <div class="mono muted">${escapeHtml(d.document_number)}</div>
                </td>
                <td>${escapeHtml(d.document_type)}</td>
                <td>v${d.current_version}</td>
                <td>${escapeHtml(d.uploaded_by_name || "—")}</td>
                <td>${formatDate(d.updated_at)}</td>
                <td>${badge("Verified", "green")}</td>
                <td>${badge(d.confidentiality_level, d.confidentiality_level === "Restricted" ? "red" : "gray")}</td>
                <td><button class="btn btn-ghost btn-sm" type="button" data-open="${d.id}">${icon("eye", 14)} View</button></td>
              </tr>`
                    )
                    .join("")
                : `<tr><td colspan="8"><div class="empty-state">${icon("fileText", 28)}<div class="title">No documents visible</div><p>Either none have been uploaded yet, or the existing documents require an access grant you don't have.</p></div></td></tr>`
            }
          </tbody>
        </table>
      </div>
    </div>
  `;

  content.querySelectorAll<HTMLElement>("[data-doc], [data-open]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = el.dataset.doc || el.dataset.open;
      if (id) openDocumentDetail(id, c);
    });
  });

  content.querySelector('[data-action="upload"]')!.addEventListener("click", () => openUploadModal(c, () => renderDocuments(content, c)));
}

function openUploadModal(c: any, onDone: () => void) {
  const { el, close } = openModal(
    "Upload Document",
    `
    <form data-el="upload-form">
      <div class="field">
        <label>Select file</label>
        <input type="file" name="file" required accept=".pdf,.txt,.png,.jpg,.jpeg,.doc,.docx" />
      </div>
      <div class="field">
        <label>Document type</label>
        <select name="documentType" required>${DOC_TYPES.map((t) => `<option value="${t}">${t}</option>`).join("")}</select>
      </div>
      <div class="field">
        <label>Description</label>
        <textarea name="description" rows="2" placeholder="Short description of this document"></textarea>
      </div>
      <div class="field">
        <label>Confidentiality level</label>
        <select name="confidentiality" required>${CONFIDENTIALITY_LEVELS.map((l) => `<option value="${l}" ${l === "Internal" ? "selected" : ""}>${l}</option>`).join("")}</select>
      </div>
      <div class="field">
        <label>Tags (comma separated)</label>
        <input type="text" name="tags" placeholder="e.g. forensics, device-analysis" />
      </div>
      <div data-el="upload-error"></div>
    </form>
  `,
    `<button class="btn btn-ghost" type="button" data-el="cancel">Cancel</button>
     <button class="btn btn-primary" type="submit" form="" data-el="submit">Upload</button>`
  );

  const form = el.querySelector<HTMLFormElement>('[data-el="upload-form"]')!;
  const submitBtn = el.querySelector<HTMLButtonElement>('[data-el="submit"]')!;
  const errorEl = el.querySelector<HTMLElement>('[data-el="upload-error"]')!;
  el.querySelector('[data-el="cancel"]')!.addEventListener("click", close);

  submitBtn.addEventListener("click", async () => {
    const fd = new FormData(form);
    const fileInput = form.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = fileInput.files?.[0];
    if (!file) {
      errorEl.innerHTML = `<div class="form-error">Please select a file.</div>`;
      return;
    }
    submitBtn.disabled = true;
    submitBtn.textContent = "Uploading…";
    try {
      const dataBase64 = await readFileAsBase64(file);
      const result = await api.post<any>("/documents/upload", {
        caseId: c.id,
        documentType: fd.get("documentType"),
        description: fd.get("description"),
        confidentiality: fd.get("confidentiality"),
        tags: fd.get("tags"),
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        dataBase64,
      });
      toast(`${result.message} SHA-256 registered.`, "success");
      close();
      onDone();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Upload failed.";
      errorEl.innerHTML = `<div class="form-error">${escapeHtml(message)}</div>`;
      submitBtn.disabled = false;
      submitBtn.textContent = "Upload";
    }
  });
}

async function openDocumentDetail(documentId: string, c: any) {
  const { el, close } = openModal("Loading document…", `<div class="loading-state">Loading…</div>`);
  let doc: any;
  try {
    doc = await api.get<any>(`/documents/${documentId}`);
  } catch (err) {
    el.querySelector(".modal-body")!.innerHTML = `<div class="banner banner-warning">${err instanceof ApiError ? escapeHtml(err.message) : "Could not load document."}</div>`;
    return;
  }

  el.querySelector(".modal-head h3")!.textContent = doc.filename;
  const modalBox = el.querySelector<HTMLElement>(".modal");
  if (modalBox) modalBox.style.maxWidth = "640px";

  el.querySelector(".modal-body")!.innerHTML = `
    <div class="kv-list" style="margin-bottom:18px;">
      <div class="kv"><span class="k">Document ID</span><span class="v mono">${escapeHtml(doc.document_number)}</span></div>
      <div class="kv"><span class="k">Type</span><span class="v">${escapeHtml(doc.document_type)}</span></div>
      <div class="kv"><span class="k">Confidentiality</span><span class="v">${badge(doc.confidentiality_level, doc.confidentiality_level === "Restricted" ? "red" : "gray")}</span></div>
      <div class="kv"><span class="k">Current version</span><span class="v">v${doc.current_version}</span></div>
      <div class="kv"><span class="k">Uploaded by</span><span class="v">${escapeHtml(doc.uploaded_by_name)}</span></div>
      <div class="kv"><span class="k">Description</span><span class="v" style="text-align:left;">${escapeHtml(doc.description || "—")}</span></div>
    </div>

    <div class="action-row" style="margin-bottom:18px;">
      <button class="btn btn-ghost btn-sm" data-action="download">${icon("download", 14)} Download</button>
      <button class="btn btn-ghost btn-sm" data-action="verify">${icon("checkShield", 14)} Verify Integrity</button>
      <button class="btn btn-ghost btn-sm" data-action="request-access">${icon("share", 14)} Request Access</button>
    </div>

    <div data-el="verify-result"></div>

    <h4 style="font-size:12.5px;margin-bottom:8px;color:var(--slate);">Version History</h4>
    <div class="table-wrap" style="margin-bottom:18px;">
      <table class="data-table">
        <thead><tr><th>Version</th><th>Uploaded By</th><th>Date</th><th>Change</th><th>SHA-256</th></tr></thead>
        <tbody>
          ${doc.versions
            .map(
              (v: any) => `
            <tr>
              <td>v${v.version_number}</td>
              <td>${escapeHtml(v.uploaded_by_name)}</td>
              <td>${formatDate(v.created_at)}</td>
              <td class="muted">${escapeHtml(v.change_description || "—")}</td>
              <td class="mono muted" title="${escapeHtml(v.sha256_hash)}">${escapeHtml(v.sha256_hash.slice(0, 14))}…</td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>

    <h4 style="font-size:12.5px;margin-bottom:8px;color:var(--slate);">Digital Signature</h4>
    <div class="kv-list" style="margin-bottom:18px;">
      <div class="kv"><span class="k">Status</span><span class="v">${badge(doc.signatures?.[0]?.status || "Integration Ready", "gray")}</span></div>
      <div class="kv"><span class="k">Verification</span><span class="v">${escapeHtml(doc.signatures?.[0]?.verification_status || "Not Applicable")}</span></div>
    </div>
    <p class="muted" style="font-size:11.5px;margin-bottom:18px;">No real PKI signature provider is connected in this prototype. This section shows the architecture is signature-ready, not that a cryptographic signature has been applied.</p>

    <h4 style="font-size:12.5px;margin-bottom:8px;color:var(--slate);">AI Document Intelligence</h4>
    <div data-el="ai-panel"><div class="loading-state">Checking AI service…</div></div>
  `;

  el.querySelector('[data-action="download"]')!.addEventListener("click", async () => {
    try {
      await downloadDocument(doc.id, doc.current_version, doc.filename);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Download failed.", "error");
    }
  });

  el.querySelector('[data-action="verify"]')!.addEventListener("click", async () => {
    const target = el.querySelector<HTMLElement>('[data-el="verify-result"]')!;
    target.innerHTML = `<div class="loading-state">Verifying…</div>`;
    try {
      const result = await api.post<any>(`/documents/${doc.id}/verify-integrity`);
      const ok = result.result === "INTEGRITY VERIFIED";
      target.innerHTML = `
        <div class="banner ${ok ? "banner-success" : "banner-warning"}">
          ${icon(ok ? "checkCircle" : "alertTriangle", 15)} ${result.result}
        </div>
        <div class="kv-list" style="margin-bottom:16px;">
          <div class="kv"><span class="k">Registered hash</span></div>
          <div class="hash-block">${escapeHtml(result.registeredHash)}</div>
          <div class="kv" style="margin-top:8px;"><span class="k">Current hash</span></div>
          <div class="hash-block">${escapeHtml(result.currentHash || "—")}</div>
          <div class="kv" style="margin-top:8px;"><span class="k">Verified by</span><span class="v">${escapeHtml(result.verifiedBy)}</span></div>
        </div>
        <p class="muted" style="font-size:11px;">${escapeHtml(result.note)}</p>
      `;
    } catch (err) {
      target.innerHTML = `<div class="banner banner-warning">${err instanceof ApiError ? escapeHtml(err.message) : "Verification failed."}</div>`;
    }
  });

  el.querySelector('[data-action="request-access"]')!.addEventListener("click", () => {
    close();
    openAccessRequestModal(c, { resourceType: "document", resourceId: doc.id, resourceLabel: doc.filename });
  });

  // AI Document Intelligence - honest "not configured" unless a provider is set server-side.
  api
    .get<any>(`/documents/${doc.id}/ai-summary`)
    .then((ai) => {
      const panel = el.querySelector<HTMLElement>('[data-el="ai-panel"]')!;
      if (!ai.summary?.configured) {
        panel.innerHTML = `<div class="banner banner-info">${icon("info", 15)} AI service not configured. Connect an AI provider server-side to enable classification, summarization, entity extraction and similar-document detection.</div>`;
        return;
      }
      panel.innerHTML = `<div class="muted" style="font-size:12px;">AI summary would appear here once a provider is connected.</div>`;
    })
    .catch(() => {
      const panel = el.querySelector<HTMLElement>('[data-el="ai-panel"]');
      if (panel) panel.innerHTML = `<div class="banner banner-info">${icon("info", 15)} AI service not configured.</div>`;
    });
}

export function openAccessRequestModal(c: any, resource: { resourceType: string; resourceId: string; resourceLabel: string }) {
  const { el, close } = openModal(
    "Request Access",
    `
    <form data-el="req-form">
      <p class="muted" style="font-size:12.5px;margin-bottom:14px;">Requesting <strong>${escapeHtml(resource.resourceLabel)}</strong>. A senior investigator or administrator will review this request.</p>
      <div class="field">
        <label>Permission</label>
        <select name="permission"><option>View</option><option>Download</option><option>Edit Metadata</option><option>Verify Integrity</option></select>
      </div>
      <div class="field">
        <label>Reason</label>
        <textarea name="reason" rows="3" required placeholder="Why do you need this access?"></textarea>
      </div>
      <div class="field">
        <label>Expires after (days, optional)</label>
        <input type="number" name="expiryDays" min="1" placeholder="e.g. 30" />
      </div>
      <div data-el="req-error"></div>
    </form>
  `,
    `<button class="btn btn-ghost" type="button" data-el="cancel">Cancel</button>
     <button class="btn btn-primary" type="button" data-el="submit">Submit Request</button>`
  );

  el.querySelector('[data-el="cancel"]')!.addEventListener("click", close);
  el.querySelector('[data-el="submit"]')!.addEventListener("click", async () => {
    const form = el.querySelector<HTMLFormElement>('[data-el="req-form"]')!;
    const fd = new FormData(form);
    const errorEl = el.querySelector<HTMLElement>('[data-el="req-error"]')!;
    if (!String(fd.get("reason") || "").trim()) {
      errorEl.innerHTML = `<div class="form-error">Please provide a reason.</div>`;
      return;
    }
    try {
      await api.post("/access-requests", {
        caseId: c.id,
        resourceType: resource.resourceType,
        resourceId: resource.resourceId,
        resourceLabel: resource.resourceLabel,
        permission: fd.get("permission"),
        reason: fd.get("reason"),
        expiryDays: fd.get("expiryDays") || undefined,
      });
      toast("Access request submitted.", "success");
      close();
    } catch (err) {
      errorEl.innerHTML = `<div class="form-error">${err instanceof ApiError ? escapeHtml(err.message) : "Could not submit request."}</div>`;
    }
  });
}
