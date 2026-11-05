import { ReactNode } from "react";
import { formatDateTime } from "@/lib/format";
import clsx from "clsx";

export interface TimelineEntry {
  id: string;
  title: ReactNode;
  detail?: ReactNode;
  timestamp: string;
  tone?: "neutral" | "success" | "warning" | "danger";
}

const DOT_STYLES: Record<string, string> = {
  neutral: "bg-navy-400",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
};

export function Timeline({ entries }: { entries: TimelineEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <ol className="relative border-l border-border pl-5">
      {entries.map((entry) => (
        <li key={entry.id} className="mb-6 last:mb-0">
          <span
            className={clsx("absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-white", DOT_STYLES[entry.tone ?? "neutral"])}
            aria-hidden="true"
          />
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <p className="text-sm font-medium text-ink">{entry.title}</p>
            <time className="text-xs text-ink-subtle whitespace-nowrap">{formatDateTime(entry.timestamp)}</time>
          </div>
          {entry.detail && <div className="mt-0.5 text-sm text-ink-muted">{entry.detail}</div>}
        </li>
      ))}
    </ol>
  );
}
