import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { EmptyState } from "@/components/EmptyState";
import { NotificationItem } from "@/types";
import { formatRelative } from "@/lib/format";
import { Bell, CheckCheck } from "lucide-react";
import clsx from "clsx";
import { Link } from "react-router-dom";

export function NotificationsPage() {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["notifications"],
    queryFn: async () => (await api.get("/notifications")).data.notifications as NotificationItem[],
  });

  async function markRead(id: string) {
    await api.post(`/notifications/${id}/read`);
    qc.invalidateQueries({ queryKey: ["notifications"] });
  }

  async function markAllRead() {
    await api.post("/notifications/read-all");
    qc.invalidateQueries({ queryKey: ["notifications"] });
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-ink">Notifications</h1>
        <button className="btn-secondary" onClick={markAllRead}>
          <CheckCheck className="h-4 w-4" /> Mark all read
        </button>
      </div>

      {isLoading ? (
        <p className="text-sm text-ink-subtle">Loading…</p>
      ) : (data?.length ?? 0) === 0 ? (
        <EmptyState icon={Bell} title="No notifications" description="Access requests, custody transfers, and integrity alerts will appear here." />
      ) : (
        <ul className="space-y-2">
          {data!.map((n) => (
            <li
              key={n.id}
              className={clsx("card flex items-start justify-between gap-4 p-4", !n.isRead && "border-l-4 border-l-teal")}
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">{n.title}</p>
                <p className="mt-0.5 text-sm text-ink-muted">{n.body}</p>
                <p className="mt-1 text-xs text-ink-subtle">{formatRelative(n.createdAt)}</p>
              </div>
              <div className="flex flex-shrink-0 items-center gap-2">
                {n.relatedCaseId && n.relatedEvidenceId ? (
                  <Link to={`/cases/${n.relatedCaseId}/evidence/${n.relatedEvidenceId}`} className="btn-secondary px-3 py-1 text-xs">
                    Review
                  </Link>
                ) : (
                  n.relatedCaseId && (
                    <Link to={`/cases/${n.relatedCaseId}`} className="text-xs font-medium text-teal hover:underline">
                      View case
                    </Link>
                  )
                )}
                {!n.isRead && (
                  <button onClick={() => markRead(n.id)} className="text-xs font-medium text-ink-subtle hover:text-ink">
                    Mark read
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
