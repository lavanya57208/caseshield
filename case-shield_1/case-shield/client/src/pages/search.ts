import { api } from "../api.js";
import { icon } from "../components/icons.js";
import { badge } from "../components/badge.js";
import { escapeHtml, formatDate } from "../util.js";
import { navigate } from "../router.js";

export async function renderSearch(content: HTMLElement, _params: Record<string, string>, query: URLSearchParams) {
  const q = query.get("q") || "";

  content.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Search</h1>
        <div class="sub">Search across cases, documents and evidence. Results only include what you're authorized to see.</div>
      </div>
    </div>
    <form class="toolbar" data-el="form">
      <input type="search" name="q" value="${escapeHtml(q)}" placeholder="Search cases, documents, evidence…" style="min-width:320px;" autofocus />
      <button class="btn btn-primary btn-sm" type="submit">${icon("search", 14)} Search</button>
    </form>
    <div data-el="results"></div>
  `;

  const form = content.querySelector<HTMLFormElement>('[data-el="form"]')!;
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const val = new FormData(form).get("q");
    navigate(`/search?q=${encodeURIComponent(String(val || ""))}`);
  });

  const results = content.querySelector<HTMLElement>('[data-el="results"]')!;
  if (!q) {
    results.innerHTML = `<div class="empty-state">${icon("search", 28)}<div class="title">Search for a case, document or evidence item</div></div>`;
    return;
  }

  results.innerHTML = `<div class="loading-state">Searching…</div>`;
  const data = await api.get<any>(`/search?q=${encodeURIComponent(q)}`);

  const totalResults = data.cases.length + data.documents.length + data.evidence.length;
  if (totalResults === 0) {
    results.innerHTML = `<div class="empty-state">${icon("search", 28)}<div class="title">No results for "${escapeHtml(q)}"</div></div>`;
    return;
  }

  results.innerHTML = `
    ${
      data.cases.length
        ? section(
            "Cases",
            data.cases
              .map(
                (c: any) => `
        <div class="kv" style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px dashed var(--border);cursor:pointer;" data-case="${c.id}">
          <div><div style="font-weight:600;font-size:13px;">${escapeHtml(c.title)}</div><div class="mono muted">${escapeHtml(c.caseNumber)} · ${escapeHtml(c.category)}</div></div>
          ${badge(c.status)}
        </div>`
              )
              .join("")
          )
        : ""
    }
    ${
      data.documents.length
        ? section(
            "Documents",
            data.documents
              .map(
                (d: any) => `
        <div class="kv" style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px dashed var(--border);cursor:pointer;" data-case="${d.caseId}">
          <div><div style="font-weight:600;font-size:13px;">${icon("fileText", 13)} ${escapeHtml(d.filename)}</div><div class="mono muted">${escapeHtml(d.documentNumber)} · ${escapeHtml(d.caseNumber)}</div></div>
          ${badge(d.documentType, "gray")}
        </div>`
              )
              .join("")
          )
        : ""
    }
    ${
      data.evidence.length
        ? section(
            "Evidence",
            data.evidence
              .map(
                (ev: any) => `
        <div class="kv" style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px dashed var(--border);cursor:pointer;" data-case="${ev.caseId}">
          <div><div style="font-weight:600;font-size:13px;">${escapeHtml(ev.evidenceCode)}</div><div class="muted">${escapeHtml(ev.evidenceType)} · ${escapeHtml(ev.caseNumber)}</div></div>
          ${badge(ev.integrityStatus, ev.integrityStatus === "Verified" ? "green" : "amber")}
        </div>`
              )
              .join("")
          )
        : ""
    }
  `;

  results.querySelectorAll<HTMLElement>("[data-case]").forEach((el) => {
    el.addEventListener("click", () => navigate(`/cases/${el.dataset.case}`));
  });
}

function section(title: string, rows: string) {
  return `<div class="card"><div class="card-title">${title}</div>${rows}</div>`;
}
