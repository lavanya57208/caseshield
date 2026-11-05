import { Fragment, useState } from "react";
import clsx from "clsx";
import { ArrowDown, Hash } from "lucide-react";
import { CustodyEvent } from "@/types";
import { CUSTODY_ACTION_META } from "@/lib/evidence";
import { truncateHash } from "@/lib/format";
import type { BadgeTone } from "@/components/StatusBadge";

const ACCESS_ACTIONS = new Set(["VIEWED", "VERIFIED"]);

const ICON_TONE: Record<BadgeTone, string> = {
  success: "bg-success-bg text-success",
  warning: "bg-warning-bg text-warning",
  danger: "bg-danger-bg text-danger",
  neutral: "bg-navy-50 text-navy-500",
  info: "bg-teal/10 text-teal-dark",
};

function stamp(value: string) {
  const d = new Date(value);
  const date = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return `${date} • ${time}`;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2 text-sm">
      <dt className="w-20 flex-shrink-0 text-ink-subtle">{label}</dt>
      <dd className="min-w-0 text-ink">{children}</dd>
    </div>
  );
}

/**
 * Chain-of-custody timeline. Custody-changing events are shown by default;
 * access (VIEWED) and verification (VERIFIED) entries — which are part of
 * the same hash chain — can be revealed with the toggle.
 */
export function CustodyTimeline({ events, highlightSequence }: { events: CustodyEvent[]; highlightSequence?: number[] }) {
  const [showAccess, setShowAccess] = useState(false);
  const accessCount = events.filter((e) => ACCESS_ACTIONS.has(e.action)).length;
  const visible = showAccess ? events : events.filter((e) => !ACCESS_ACTIONS.has(e.action));

  return (
    <div>
      {accessCount > 0 && (
        <label className="mb-4 inline-flex cursor-pointer items-center gap-2 text-xs text-ink-muted">
          <input type="checkbox" className="h-3.5 w-3.5 accent-teal" checked={showAccess} onChange={(e) => setShowAccess(e.target.checked)} />
          Show access &amp; verification entries ({accessCount})
        </label>
      )}
      <ol className="flex flex-col items-stretch" aria-label="Chain of custody">
        {visible.map((e, i) => {
          const meta = CUSTODY_ACTION_META[e.action] ?? CUSTODY_ACTION_META.REGISTERED;
          const Icon = meta.icon;
          const flagged = highlightSequence?.includes(e.sequence);
          const handover = e.fromUser && e.toUser && e.fromUser.id !== e.toUser.id;
          return (
            <Fragment key={e.id}>
              {i > 0 && (
                <li aria-hidden="true" className="flex justify-center py-1.5 text-navy-200">
                  <ArrowDown className="h-4 w-4" />
                </li>
              )}
              <li className={clsx("rounded-lg border bg-white p-4", flagged ? "border-danger ring-1 ring-danger/30" : "border-border")}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className={clsx("flex h-8 w-8 items-center justify-center rounded-md", ICON_TONE[meta.tone])}>
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-ink">{meta.label}</p>
                      <time className="text-xs text-ink-subtle" dateTime={e.occurredAt}>{stamp(e.occurredAt)}</time>
                    </div>
                  </div>
                  {e.transfer?.status === "PENDING" && e.action === "TRANSFERRED" && (
                    <span className="rounded-md border border-warning/20 bg-warning-bg px-2 py-0.5 text-xs font-medium text-warning">Pending receipt</span>
                  )}
                </div>
                <dl className="mt-3 space-y-1">
                  {handover ? (
                    <>
                      <Row label="From">{e.fromUser!.fullName}</Row>
                      <Row label="To">{e.toUser!.fullName}</Row>
                      {e.actor.id !== e.fromUser!.id && e.actor.id !== e.toUser!.id && <Row label="By">{e.actor.fullName}</Row>}
                      {e.action === "RECEIVED" && <Row label="By">{e.actor.fullName}</Row>}
                    </>
                  ) : (
                    <Row label="By">{e.actor.fullName}</Row>
                  )}
                  {e.action === "REGISTERED" && e.toUser && <Row label="Custodian">{e.toUser.fullName}</Row>}
                  {e.action !== "RECEIVED" && e.action !== "VIEWED" && <Row label="Reason">{e.reason}</Row>}
                  {e.notes && <Row label="Notes">{e.notes}</Row>}
                  {e.location && <Row label="Location">{e.location}</Row>}
                </dl>
                <p className="mt-3 flex items-center gap-1 border-t border-border pt-2 font-mono text-[11px] text-ink-subtle" title={e.eventHash ?? "Not sealed"}>
                  <Hash className="h-3 w-3" aria-hidden="true" />
                  {e.sequence} · {e.eventHash ? truncateHash(e.eventHash, 10) : "unsealed"}
                </p>
              </li>
            </Fragment>
          );
        })}
      </ol>
    </div>
  );
}
