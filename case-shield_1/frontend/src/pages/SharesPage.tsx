import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { api, normalizeApiError } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/components/Toast";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/EmptyState";
import { SkeletonRows } from "@/components/Skeleton";
import { downloadFile, viewFile } from "@/lib/files";
import { formatDateTime } from "@/lib/format";
import { DocumentShare } from "@/types";
import { Share2, Eye, Download, Lock, Check, X as XIcon } from "lucide-react";

type Scope = "incoming" | "outgoing" | "approvals";

/**
 * Secure Shares — recipients open documents shared with them here (the
 * only way a recipient reaches shared content), sharers track their shares,
 * and approvers review pending requests. Button state mirrors the server's
 * per-share access evaluation; the server re-checks on every request.
 */
export function SharesPage() {
  const { hasPermission } = useAuth();
  const canApprove = hasPermission("access.approve");
  const [scope, setScope] = useState<Scope>("incoming");
  const tabs: { key: Scope; label: string }[] = [
    { key: "incoming", label: "Shared with me" },
    { key: "outgoing", label: "Shared by me" },
    ...(canApprove ? [{ key: "approvals" as Scope, label: "Pending approvals" }] : []),
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-ink">
          <Share2 className="h-5 w-5" aria-hidden="true" /> Secure shares
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          Purpose-bound, time-limited access to protected copies of case documents. Every view and download is audited.
        </p>
      </div>
      <div className="flex gap-1 border-b border-border" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={scope === t.key}
            onClick={() => setScope(t.key)}
            className={clsx(
              "-mb-px border-b-2 px-4 py-2 text-sm font-medium",
              scope === t.key ? "border-teal text-ink" : "border-transparent text-ink-subtle hover:text-ink",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <ShareList scope={scope} />
    </div>
  );
}

function ShareList({ scope }: { scope: Scope }) {
  const { notify } = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["shares", scope],
    queryFn: async () => (await api.get("/shares", { params: { scope } })).data.shares as DocumentShare[],
  });

  async function act(id: string, action: "approve" | "reject" | "revoke") {
    try {
      await api.post(`/shares/${id}/${action}`, {});
      notify(`Share ${action === "approve" ? "approved" : action === "reject" ? "rejected" : "revoked"}.`, "success");
      qc.invalidateQueries({ queryKey: ["shares"] });
    } catch (err) {
      notify(normalizeApiError(err).message, "danger");
    }
  }

  async function open(share: DocumentShare, mode: "view" | "download") {
    try {
      if (mode === "view") await viewFile(`/shares/${share.id}/view`);
      else await downloadFile(`/shares/${share.id}/download`, share.document.title);
      qc.invalidateQueries({ queryKey: ["shares"] });
    } catch (err: any) {
      notify(err?.message ?? "Access denied.", "danger");
      qc.invalidateQueries({ queryKey: ["shares"] });
    }
  }

  if (isLoading) return <div className="card p-4"><SkeletonRows rows={4} /></div>;
  if (!data || data.length === 0) {
    return (
      <div className="card">
        <EmptyState
          icon={Share2}
          title={scope === "incoming" ? "Nothing has been shared with you" : scope === "outgoing" ? "You have not shared any documents" : "No shares awaiting your approval"}
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {data.map((s) => (
        <div key={s.id} className="card flex flex-wrap items-start justify-between gap-4 p-4">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium text-ink">{s.document.title}</p>
              <StatusBadge status={s.status} />
              <StatusBadge status={s.document.confidentiality} />
            </div>
            <p className="text-xs text-ink-subtle">
              {s.document.documentNumber} · {s.case.caseNumber} · v{s.sourceVersionNumber}
            </p>
            <p className="text-sm text-ink-muted">
              <span className="font-medium text-ink">Purpose:</span> {s.purposeLabel}
              {scope !== "incoming" && (
                <>
                  {" · "}
                  <span className="font-medium text-ink">Recipient:</span> {s.recipientOrganization ? `${s.recipientOrganization} · ` : ""}
                  {s.recipient.fullName}
                </>
              )}
              {scope !== "outgoing" && (
                <>
                  {" · "}
                  <span className="font-medium text-ink">From:</span> {s.requestedBy.fullName}
                </>
              )}
            </p>
            <p className="text-xs text-ink-subtle">
              {formatDateTime(s.startsAt)} → {formatDateTime(s.expiresAt)} · {s.allowDownload ? "Download allowed" : "View only"}
              {s.applyRedaction ? " · PII redacted" : ""}
              {s.applyWatermark ? " · Watermarked" : ""}
              {s.requireApproval ? " · Approval required" : ""}
            </p>
            {s.access?.reason && (
              <p className="flex items-center gap-1.5 text-xs text-warning">
                <Lock className="h-3.5 w-3.5" aria-hidden="true" /> {s.access.reason}
              </p>
            )}
          </div>

          <div className="flex flex-shrink-0 flex-wrap gap-2">
            {scope === "incoming" && (
              <>
                <button className="btn-secondary" disabled={!s.access?.canView} onClick={() => open(s, "view")}>
                  <Eye className="h-4 w-4" /> View
                </button>
                {/* Rendered disabled (not hidden) so the restriction is visible; the API rejects it regardless. */}
                <button
                  className="btn-secondary"
                  disabled={!s.access?.canDownload}
                  title={s.allowDownload ? undefined : "Download is not permitted for this share"}
                  onClick={() => open(s, "download")}
                >
                  <Download className="h-4 w-4" /> Download
                </button>
              </>
            )}
            {scope === "outgoing" && (s.status === "PENDING" || s.status === "APPROVED") && (
              <button className="btn-secondary text-danger" onClick={() => act(s.id, "revoke")}>Revoke</button>
            )}
            {scope === "outgoing" && (
              <Link className="btn-ghost" to={`/documents/${s.documentId}`}>Open document</Link>
            )}
            {scope === "approvals" && (
              <>
                <button className="btn-secondary" onClick={() => act(s.id, "reject")}>
                  <XIcon className="h-4 w-4" /> Reject
                </button>
                <button className="btn-primary" onClick={() => act(s.id, "approve")}>
                  <Check className="h-4 w-4" /> Approve
                </button>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
