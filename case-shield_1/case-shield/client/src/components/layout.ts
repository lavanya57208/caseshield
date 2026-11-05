import { icon, logoMark } from "./icons.js";
import { getUser, clearSession, initials } from "../state.js";
import { api } from "../api.js";
import { navigate } from "../router.js";

interface NavItem {
  path: string;
  label: string;
  iconName: Parameters<typeof icon>[0];
}

const NAV_ITEMS: NavItem[] = [
  { path: "/dashboard", label: "Dashboard", iconName: "dashboard" },
  { path: "/cases", label: "Cases", iconName: "cases" },
  { path: "/search", label: "Search", iconName: "search" },
  { path: "/notifications", label: "Notifications", iconName: "bell" },
  { path: "/audit-log", label: "System Audit Log", iconName: "audit" },
  { path: "/profile", label: "Profile", iconName: "user" },
];

/**
 * Renders the persistent sidebar + topbar shell into #app and returns the
 * content element pages should render into, plus the topbar title setter.
 */
export function renderShell(activePath: string): { content: HTMLElement; setTitle: (t: string) => void } {
  const user = getUser();
  const app = document.getElementById("app")!;
  app.innerHTML = "";

  const shell = document.createElement("div");
  shell.className = "app-shell";

  const backdrop = document.createElement("div");
  backdrop.className = "sidebar-backdrop";

  const sidebar = document.createElement("aside");
  sidebar.className = "sidebar";
  sidebar.innerHTML = `
    <div class="sidebar-brand">
      ${logoMark(32)}
      <div>
        <span class="brand-name">CASE SHIELD</span>
        <span class="brand-sub">Secure Document Management</span>
      </div>
    </div>
    <nav class="sidebar-nav">
      ${NAV_ITEMS.map(
        (item) =>
          `<a href="${item.path}" data-path="${item.path}" class="${activePath.startsWith(item.path) ? "active" : ""}">${icon(item.iconName, 17)}<span>${item.label}</span></a>`
      ).join("")}
    </nav>
    <div class="sidebar-foot">
      <button type="button" data-action="logout">${icon("logout", 16)} Logout</button>
    </div>
  `;

  const mainCol = document.createElement("div");
  mainCol.className = "main-col";

  const topbar = document.createElement("header");
  topbar.className = "topbar";
  topbar.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;">
      <button class="hamburger" type="button" aria-label="Menu">${icon("menu", 20)}</button>
      <div class="topbar-title" data-el="title">Case Shield</div>
    </div>
    <div class="topbar-right">
      <form class="topbar-search" data-el="search-form">
        ${icon("search", 16)}
        <input type="search" placeholder="Search cases, documents, evidence…" data-el="search-input" />
      </form>
      <button class="icon-btn" type="button" data-action="notifications" aria-label="Notifications">
        ${icon("bell", 19)}
        <span class="dot" data-el="notif-dot" style="display:none;"></span>
      </button>
      <div class="user-chip" data-action="profile">
        <div class="avatar">${user ? initials(user.name) : "?"}</div>
        <div class="who">
          <div class="name">${user?.name ?? "—"}</div>
          <div class="role">${user?.role ?? ""}</div>
        </div>
      </div>
    </div>
  `;

  const content = document.createElement("main");
  content.className = "content";

  mainCol.appendChild(topbar);
  mainCol.appendChild(content);
  shell.appendChild(backdrop);
  shell.appendChild(sidebar);
  shell.appendChild(mainCol);
  app.appendChild(shell);

  // Mobile drawer toggle
  const hamburger = topbar.querySelector<HTMLButtonElement>(".hamburger")!;
  hamburger.addEventListener("click", () => {
    sidebar.classList.toggle("open");
    backdrop.classList.toggle("show");
  });
  backdrop.addEventListener("click", () => {
    sidebar.classList.remove("open");
    backdrop.classList.remove("show");
  });

  // Nav link clicks handled by the global router link interceptor, but close
  // the mobile drawer on navigation.
  sidebar.querySelectorAll("a[data-path]").forEach((a) => {
    a.addEventListener("click", () => {
      sidebar.classList.remove("open");
      backdrop.classList.remove("show");
    });
  });

  sidebar.querySelector('[data-action="logout"]')!.addEventListener("click", async () => {
    try {
      await api.post("/auth/logout");
    } catch {
      /* ignore */
    }
    clearSession();
    navigate("/login");
  });

  topbar.querySelector('[data-action="profile"]')!.addEventListener("click", () => navigate("/profile"));
  topbar.querySelector('[data-action="notifications"]')!.addEventListener("click", () => navigate("/notifications"));

  const searchForm = topbar.querySelector<HTMLFormElement>('[data-el="search-form"]')!;
  searchForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const input = topbar.querySelector<HTMLInputElement>('[data-el="search-input"]')!;
    if (input.value.trim()) navigate(`/search?q=${encodeURIComponent(input.value.trim())}`);
  });

  // Notification dot
  api
    .get<any[]>("/notifications")
    .then((notifs) => {
      const unread = notifs.filter((n) => !n.is_read).length;
      const dot = topbar.querySelector<HTMLElement>('[data-el="notif-dot"]')!;
      dot.style.display = unread > 0 ? "block" : "none";
    })
    .catch(() => {});

  const setTitle = (t: string) => {
    topbar.querySelector('[data-el="title"]')!.textContent = t;
  };

  return { content, setTitle };
}
