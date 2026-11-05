import { api } from "../api.js";
import { icon } from "../components/icons.js";
import { badge, priorityBadge } from "../components/badge.js";
import { escapeHtml, formatDate } from "../util.js";
import { navigate } from "../router.js";

export async function renderCases(content: HTMLElement, _params: Record<string, string>, query: URLSearchParams) {
  const [{ categories }, courts, cases] = await Promise.all([
    api.get<any>("/reference/categories"),
    api.get<any[]>("/reference/courts"),
    api.get<any[]>("/cases"),
  ]);

  const categoryId = query.get("category") || "";
  const q = query.get("q") || "";
  const status = query.get("status") || "";
  const priority = query.get("priority") || "";
  const courtId = query.get("court") || "";
  const sort = query.get("sort") || "updated";

  if (!categoryId && !q && !status && !priority && !courtId) {
    renderCategoryGrid(content, categories, cases);
    return;
  }

  renderCaseTable(content, { categories, courts, cases, categoryId, q, status, priority, courtId, sort });
}

function renderCategoryGrid(content: HTMLElement, categories: any[], cases: any[]) {
  const countByCategory: Record<string, number> = {};
  for (const c of cases) countByCategory[c.category_id] = (countByCategory[c.category_id] || 0) + 1;

  content.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Cases</h1>
        <div class="sub">Organized by court/forum, category and case type. Choose a category to view its cases.</div>
      </div>
      <a class="btn btn-ghost" href="/cases?status=">${icon("filter", 15)} View all cases</a>
    </div>
    <div class="grid grid-3">
      ${categories
        .map(
          (cat: any) => `
        <div class="category-card" data-cat="${cat.id}">
          <div class="name">${escapeHtml(cat.name)}</div>
          <div class="count">${countByCategory[cat.id] || 0} case${(countByCategory[cat.id] || 0) === 1 ? "" : "s"}</div>
        </div>`
        )
        .join("")}
    </div>
  `;
  content.querySelectorAll<HTMLElement>("[data-cat]").forEach((el) => {
    el.addEventListener("click", () => navigate(`/cases?category=${el.dataset.cat}`));
  });
}

function renderCaseTable(
  content: HTMLElement,
  opts: { categories: any[]; courts: any[]; cases: any[]; categoryId: string; q: string; status: string; priority: string; courtId: string; sort: string }
) {
  const { categories, courts, cases, categoryId, q, status, priority, courtId, sort } = opts;
  const category = categories.find((c: any) => c.id === categoryId);

  let filtered = cases.filter((c: any) => {
    if (categoryId && c.category_id !== categoryId) return false;
    if (status && c.status !== status) return false;
    if (priority && c.priority !== priority) return false;
    if (courtId && c.court_id !== courtId) return false;
    if (q && !(c.title.toLowerCase().includes(q.toLowerCase()) || c.case_number.toLowerCase().includes(q.toLowerCase()))) return false;
    return true;
  });

  filtered = filtered.sort((a: any, b: any) => {
    if (sort === "priority") {
      const order: Record<string, number> = { High: 0, Medium: 1, Low: 2 };
      return (order[a.priority] ?? 9) - (order[b.priority] ?? 9);
    }
    if (sort === "created") return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  });

  const statuses = Array.from(new Set(cases.map((c: any) => c.status))).sort();
  const priorities = ["High", "Medium", "Low"];

  content.innerHTML = `
    <div class="page-header">
      <div>
        <h1>${category ? escapeHtml(category.name) : "All Cases"}</h1>
        <div class="sub">${filtered.length} case${filtered.length === 1 ? "" : "s"}${category ? "" : " across all categories"}</div>
      </div>
      <a class="btn btn-ghost" href="/cases">${icon("chevronRight", 14)} Back to categories</a>
    </div>

    <form class="toolbar" data-el="filters">
      <input type="search" name="q" placeholder="Search title or case number…" value="${escapeHtml(q)}" style="min-width:220px;" />
      <select name="status"><option value="">All statuses</option>${statuses.map((s) => `<option value="${s}" ${s === status ? "selected" : ""}>${s}</option>`).join("")}</select>
      <select name="priority"><option value="">All priorities</option>${priorities.map((p) => `<option value="${p}" ${p === priority ? "selected" : ""}>${p}</option>`).join("")}</select>
      <select name="court"><option value="">All courts/forums</option>${courts.map((c: any) => `<option value="${c.id}" ${c.id === courtId ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}</select>
      <select name="sort">
        <option value="updated" ${sort === "updated" ? "selected" : ""}>Sort: Recently updated</option>
        <option value="created" ${sort === "created" ? "selected" : ""}>Sort: Recently created</option>
        <option value="priority" ${sort === "priority" ? "selected" : ""}>Sort: Priority</option>
      </select>
      <button class="btn btn-ghost btn-sm" type="submit">Apply</button>
    </form>

    <div class="card" style="padding:0;">
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr>
            <th>Case</th><th>Type</th><th>Court / Forum</th><th>Status</th><th>Priority</th><th>Investigator</th><th>Docs</th><th>Evidence</th>
          </tr></thead>
          <tbody>
            ${
              filtered.length
                ? filtered
                    .map(
                      (c: any) => `
              <tr class="clickable" data-case="${c.id}">
                <td><div style="font-weight:600;">${escapeHtml(c.title)}</div><div class="mono muted">${escapeHtml(c.case_number)}</div></td>
                <td>${escapeHtml(c.case_type_name)}</td>
                <td>${escapeHtml(c.court_name)}</td>
                <td>${badge(c.status)}</td>
                <td>${priorityBadge(c.priority)}</td>
                <td>${escapeHtml(c.investigator_name || "—")}</td>
                <td>${c.document_count ?? 0}</td>
                <td>${c.evidence_count ?? 0}</td>
              </tr>`
                    )
                    .join("")
                : `<tr><td colspan="8"><div class="empty-state">${icon("cases", 28)}<div class="title">No cases match these filters</div></div></td></tr>`
            }
          </tbody>
        </table>
      </div>
    </div>
  `;

  content.querySelectorAll<HTMLElement>("[data-case]").forEach((el) => {
    el.addEventListener("click", () => navigate(`/cases/${el.dataset.case}`));
  });

  const form = content.querySelector<HTMLFormElement>('[data-el="filters"]')!;
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const params = new URLSearchParams();
    if (categoryId) params.set("category", categoryId);
    for (const key of ["q", "status", "priority", "court", "sort"]) {
      const v = String(fd.get(key) || "");
      if (v) params.set(key === "court" ? "court" : key, v);
    }
    navigate(`/cases?${params.toString()}`);
  });
}
