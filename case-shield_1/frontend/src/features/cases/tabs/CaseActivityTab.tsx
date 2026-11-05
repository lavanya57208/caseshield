import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Timeline, TimelineEntry } from "@/components/Timeline";

export function CaseActivityTab({ caseId }: { caseId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["case-activity", caseId],
    queryFn: async () => (await api.get(`/cases/${caseId}/activity`)).data.events as any[],
  });

  const entries: TimelineEntry[] =
    data?.map((e) => ({
      id: e.id,
      title: `${e.action.replace(/_/g, " ")}${e.result !== "SUCCESS" ? ` (${e.result})` : ""}`,
      detail: e.actor?.fullName ?? "System",
      timestamp: e.occurredAt,
      tone: e.result === "DENIED" ? "danger" : e.result === "ERROR" ? "danger" : "neutral",
    })) ?? [];

  return (
    <div className="card p-5">
      <h2 className="mb-4 text-sm font-semibold text-ink">Full activity feed</h2>
      {isLoading ? (
        <p className="text-sm text-ink-subtle">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-ink-subtle">No activity recorded for this case yet.</p>
      ) : (
        <Timeline entries={entries} />
      )}
    </div>
  );
}
