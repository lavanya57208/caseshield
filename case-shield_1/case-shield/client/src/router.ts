import { getToken } from "./state.js";
import { renderShell } from "./components/layout.js";

type RouteHandler = (content: HTMLElement, params: Record<string, string>, query: URLSearchParams, setTitle: (t: string) => void) => void | Promise<void>;

interface Route {
  path: string;
  regex: RegExp;
  keys: string[];
  handler: RouteHandler;
  title: string;
}

const routes: Route[] = [];
let loginHandler: RouteHandler | null = null;

function compile(path: string): { regex: RegExp; keys: string[] } {
  const keys: string[] = [];
  const pattern = path
    .split("/")
    .map((seg) => {
      if (seg.startsWith(":")) {
        keys.push(seg.slice(1));
        return "([^/]+)";
      }
      return seg;
    })
    .join("/");
  return { regex: new RegExp(`^${pattern}$`), keys };
}

export function addRoute(path: string, title: string, handler: RouteHandler) {
  const { regex, keys } = compile(path);
  routes.push({ path, regex, keys, handler, title });
}

export function setLoginRoute(handler: RouteHandler) {
  loginHandler = handler;
}

export function navigate(path: string) {
  if (location.pathname + location.search === path) return;
  history.pushState({}, "", path);
  render();
}

let renderToken = 0;

async function render() {
  const myToken = ++renderToken;
  const pathname = location.pathname === "/" ? "/dashboard" : location.pathname;
  const query = new URLSearchParams(location.search);
  const token = getToken();

  if (pathname === "/login") {
    if (token) {
      navigate("/dashboard");
      return;
    }
    const app = document.getElementById("app")!;
    app.innerHTML = "";
    const content = document.createElement("div");
    app.appendChild(content);
    if (loginHandler) await loginHandler(content, {}, query, () => {});
    return;
  }

  if (!token) {
    navigate("/login");
    return;
  }

  for (const route of routes) {
    const m = route.regex.exec(pathname);
    if (m) {
      const params: Record<string, string> = {};
      route.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      const { content, setTitle } = renderShell(pathname);
      setTitle(route.title);
      content.innerHTML = `<div class="loading-state">Loading…</div>`;
      try {
        await route.handler(content, params, query, setTitle);
      } catch (err: any) {
        if (myToken !== renderToken) return;
        content.innerHTML = `<div class="banner banner-warning">${err?.message || "Something went wrong loading this page."}</div>`;
      }
      return;
    }
  }

  const { content } = renderShell(pathname);
  content.innerHTML = `<div class="empty-state"><div class="title">Page not found</div><p>That page doesn't exist.</p></div>`;
}

function onLinkClick(e: MouseEvent) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const anchor = (e.target as HTMLElement).closest("a");
  if (!anchor) return;
  const href = anchor.getAttribute("href");
  if (!href || !href.startsWith("/") || anchor.target === "_blank" || anchor.hasAttribute("data-external")) return;
  e.preventDefault();
  navigate(href);
}

export function startRouter() {
  document.addEventListener("click", onLinkClick);
  window.addEventListener("popstate", render);
  render();
}

export { render as rerender };
