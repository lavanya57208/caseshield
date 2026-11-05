import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { Download, ExternalLink, FileText, Search, UploadCloud } from "lucide-react";
import { api } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
import { Skeleton } from "@/components/Skeleton";
import { useToast } from "@/components/Toast";
import { useAuth } from "@/hooks/useAuth";
import { DocumentSummary } from "@/types";
import { formatDate, formatFileSize } from "@/lib/format";
import { downloadFile } from "@/lib/files";
import { documentTypeLabel, fileIcon } from "@/lib/documents";

export function CaseDocumentsTab({ caseId, caseNumber, onUpload }: { caseId: string; caseNumber: string; onUpload?: () => void }) {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const { notify } = useToast();
  const [filter, setFilter] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["documents", caseId],
    queryFn: async () => (await api.get("/documents", { params: { caseId, pageSize: 100 } })).data as { items: DocumentSummary[]; total: number },
  });

  const rows = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const items = data?.items ?? [];
    return f ? items.filter((d) => `${d.title} ${d.documentNumber} ${documentTypeLabel(d.type)}`.toLowerCase().includes(f)) : items;
  }, [data, filter]);

  const canDownload = hasPermission("document.download");

  async function download(d: DocumentSummary) {
    try {
      await downloadFile(`/documents/${d.id}/download`, d.versions[0]?.fileName ?? d.title);
    } catch (err: any) {
      notify("Download failed", "danger", err?.message);
    }
  }

  if (isLoading) {
    return (
      <div className="card space-y-3 p-5">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-12" />
        ))}
      </div>
    );
  }

  if ((data?.total ?? 0) === 0) {
    return (
      <div className="card flex flex-col items-center px-6 py-14 text-center">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-teal/10">
          <FileText className="h-7 w-7 text-teal" aria-hidden="true" />
        </div>
        <h3 className="text-base font-semibold text-ink">No documents yet</h3>
        <p className="mt-1 max-w-sm text-sm text-ink-muted">Upload the first document to start building this case record. Every file is hashed with SHA-256 so its integrity can be verified later.</p>
        {onUpload && (
          <button className="btn-primary mt-5" onClick={onUpload}>
            <UploadCloud className="h-4 w-4" /> Upload document
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-muted">
          <span className="font-semibold text-ink">{data?.total}</span> document{data?.total === 1 ? "" : "s"} in {caseNumber}
        </p>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" aria-hidden="true" />
            <input className="input h-9 w-56 pl-9" placeholder="Filter documents…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter documents" />
          </div>
          {onUpload && (
            <button className="btn-primary" onClick={onUpload}>
              <UploadCloud className="h-4 w-4" /> Upload document
            </button>
          )}
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface text-left">
                {["Document", "Type", "Version", "Integrity", "Uploaded by", "Updated", ""].map((h, i) => (
                  <th key={i} scope="col" className="eyebrow whitespace-nowrap px-4 py-3">
                    {h || <span className="sr-only">Actions</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => {
                const v = d.versions[0];
                const Icon = fileIcon(v?.mimeType);
                return (
                  <tr
                    key={d.id}
                    onClick={() => navigate(`/documents/${d.id}`)}
                    className="cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-navy-50/50"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-navy-50 text-navy-500">
                          <Icon className="h-4.5 w-4.5" aria-hidden="true" />
                        </div>
                        <div className="min-w-0">
                          <Link to={`/documents/${d.id}`} onClick={(e) => e.stopPropagation()} className="block max-w-[280px] truncate font-medium text-ink hover:text-teal">
                            {d.title}
                          </Link>
                          <p className="text-xs text-ink-subtle">
                            <span className="font-mono">{d.documentNumber}</span>
                            {v && ` · ${formatFileSize(v.fileSize)}`}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-ink-muted">{documentTypeLabel(d.type)}</td>
                    <td className="px-4 py-3">
                      <span className="rounded bg-navy-50 px-1.5 py-0.5 font-mono text-xs font-medium text-navy-600">v{v?.versionNumber ?? 1}</span>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={v?.integrityStatus ?? "UNVERIFIED"} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-ink-muted">{v?.uploader?.fullName ?? "—"}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-ink-subtle">{formatDate(d.updatedAt ?? d.createdAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                        <Link to={`/documents/${d.id}`} className="rounded-md p-1.5 text-ink-subtle hover:bg-navy-50 hover:text-teal" title="Open document" aria-label={`Open ${d.title}`}>
                          <ExternalLink className="h-4 w-4" />
                        </Link>
                        {canDownload && (
                          <button onClick={() => download(d)} className="rounded-md p-1.5 text-ink-subtle hover:bg-navy-50 hover:text-teal" title="Download" aria-label={`Download ${d.title}`}>
                            <Download className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-ink-subtle">
                    No documents match “{filter}”.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
