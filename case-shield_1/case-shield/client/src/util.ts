export function escapeHtml(input: unknown): string {
  return String(input ?? "").replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      default: return "&#39;";
    }
  });
}

export function formatDate(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function formatDateTime(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function timeAgo(iso?: string | null): string {
  if (!iso) return "";
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(iso);
}

let toastRoot: HTMLElement | null = null;
export function toast(message: string, kind: "info" | "success" | "error" = "info") {
  if (!toastRoot) {
    toastRoot = document.createElement("div");
    toastRoot.style.cssText = "position:fixed;bottom:20px;right:20px;z-index:200;display:flex;flex-direction:column;gap:8px;";
    document.body.appendChild(toastRoot);
  }
  const colors = { info: "#29465B", success: "#16803C", error: "#B42318" };
  const el = document.createElement("div");
  el.textContent = message;
  el.style.cssText = `background:${colors[kind]};color:#fff;padding:11px 16px;border-radius:8px;font-size:13px;box-shadow:0 4px 14px rgba(0,0,0,0.18);max-width:340px;`;
  toastRoot.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

export function qs<T extends Element = Element>(root: ParentNode, sel: string): T | null {
  return root.querySelector(sel) as T | null;
}
export function qsa<T extends Element = Element>(root: ParentNode, sel: string): T[] {
  return Array.from(root.querySelectorAll(sel)) as T[];
}
