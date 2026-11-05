import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { LayoutDashboard, FolderKanban, Search, Bell, ScrollText, LogOut, ShieldCheck, Share2, ChevronRight } from "lucide-react";
import { Logo } from "@/components/Logo";
import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import clsx from "clsx";

const NAV_ITEMS = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/cases", label: "Cases", icon: FolderKanban },
  { to: "/search", label: "Search", icon: Search },
  { to: "/notifications", label: "Notifications", icon: Bell },
  { to: "/audit", label: "Audit Trail", icon: ScrollText },
];

const SECONDARY_ITEMS = [{ to: "/shares", label: "Secure Shares", icon: Share2 }];

function initials(name?: string) {
  return (name ?? "")
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [q, setQ] = useState("");

  const { data } = useQuery({
    queryKey: ["notifications", "unread-count"],
    queryFn: async () => {
      const { data } = await api.get("/notifications");
      return data.notifications as { isRead: boolean }[];
    },
    refetchInterval: 30000,
  });
  const unreadCount = data?.filter((n) => !n.isRead).length ?? 0;

  async function handleLogout() {
    await logout();
    navigate("/login");
  }

  const primaryRole = user?.roles[0]?.name ?? "Viewer";

  const navClass = ({ isActive }: { isActive: boolean }) =>
    clsx(
      "group relative flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
      isActive ? "bg-white/10 text-white" : "text-navy-200 hover:bg-white/5 hover:text-white",
    );

  const renderItem = (item: (typeof NAV_ITEMS)[number]) => (
    <NavLink key={item.to} to={item.to} className={navClass}>
      {({ isActive }) => (
        <>
          <span className={clsx("absolute inset-y-1.5 left-0 w-1 rounded-r bg-teal-light transition-opacity", isActive ? "opacity-100" : "opacity-0")} aria-hidden="true" />
          <item.icon className={clsx("h-4.5 w-4.5", isActive ? "text-teal-light" : "text-navy-300 group-hover:text-white")} aria-hidden="true" />
          <span className="flex-1">{item.label}</span>
          {item.to === "/notifications" && unreadCount > 0 && (
            <span className="min-w-[20px] rounded-full bg-warning px-1.5 py-0.5 text-center text-[10px] font-semibold text-white">{unreadCount}</span>
          )}
        </>
      )}
    </NavLink>
  );

  return (
    <div className="flex min-h-screen bg-surface">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:rounded focus:bg-white focus:p-2">
        Skip to main content
      </a>

      <aside className="sticky top-0 hidden h-screen w-64 flex-shrink-0 flex-col bg-navy-700 md:flex">
        <div className="px-5 py-5">
          <Logo />
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2" aria-label="Primary">
          <p className="eyebrow px-3 pb-2 pt-1 text-navy-300">Workspace</p>
          {NAV_ITEMS.map(renderItem)}
          <p className="eyebrow px-3 pb-2 pt-5 text-navy-300">Sharing</p>
          {SECONDARY_ITEMS.map(renderItem)}
        </nav>

        <div className="border-t border-white/10 p-3">
          <NavLink
            to="/profile"
            className={({ isActive }) => clsx("flex items-center gap-3 rounded-md px-2.5 py-2 transition-colors", isActive ? "bg-white/10" : "hover:bg-white/5")}
          >
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-teal text-xs font-semibold text-white">{initials(user?.fullName)}</div>
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-sm font-medium text-white">{user?.fullName}</p>
              <p className="truncate text-xs text-navy-300">{primaryRole}</p>
            </div>
            <ChevronRight className="h-4 w-4 text-navy-300" aria-hidden="true" />
          </NavLink>
          <button
            onClick={handleLogout}
            className="mt-1 flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-navy-200 hover:bg-white/5 hover:text-white"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            Sign out
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 flex-shrink-0 items-center justify-between gap-4 border-b border-border bg-white/95 px-6 backdrop-blur">
          <div className="flex items-center gap-2 md:hidden">
            <div className="rounded-md bg-navy-700 p-1.5">
              <Logo compact />
            </div>
          </div>
          <form
            className="relative hidden w-full max-w-md md:block"
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              if (q.trim()) navigate(`/search?tab=document&q=${encodeURIComponent(q.trim())}`);
            }}
          >
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" aria-hidden="true" />
            <input
              className="input h-9 bg-surface pl-9"
              placeholder="Search documents and cases…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search documents"
            />
          </form>
          <div className="flex items-center gap-4">
            <span className="hidden items-center gap-1.5 rounded-full border border-success/20 bg-success-bg px-2.5 py-1 text-xs font-medium text-success lg:inline-flex">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" /> Secure session
            </span>
            <NavLink to="/notifications" className="relative rounded-md p-2 text-ink-muted hover:bg-navy-50 hover:text-ink" aria-label={`Notifications (${unreadCount} unread)`}>
              <Bell className="h-5 w-5" aria-hidden="true" />
              {unreadCount > 0 && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-warning ring-2 ring-white" />}
            </NavLink>
            <div className="hidden text-right leading-tight xl:block">
              <p className="text-sm font-medium text-ink">{user?.fullName}</p>
              <p className="text-xs text-ink-subtle">{primaryRole}</p>
            </div>
          </div>
        </header>

        <main id="main-content" className="flex-1 px-6 py-6 lg:px-8">
          <div className="mx-auto w-full max-w-[1400px]">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
