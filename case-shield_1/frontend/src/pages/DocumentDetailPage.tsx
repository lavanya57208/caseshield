import { useEffect, useState, ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  Eye,
  History,
  Lock,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  Sparkles,
  UploadCloud,
  EyeOff,
} from "lucide-react";
import { api, normalizeApiError } from "@/lib/api";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { StatusBadge } from "@/components/StatusBadge";
import { Skeleton } from "@/components/Skeleton";
import { Spinner } from "@/components/Spinner";
import { ErrorState } from "@/components/ErrorState";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/components/Toast";
import { formatDateTime, formatFileSize, truncateHash } from "@/lib/format";
import { downloadFile, fetchBlob } from "@/lib/files";
import { documentTypeLabel, fileIcon, isPreviewable } from "@/lib/documents";
import { DocumentSecurityPanel } from "@/features/security/DocumentSecurityPanel";
import { DocumentIntelligencePanel } from "@/features/intelligence/DocumentIntelligencePanel";
import { NewVersionDialog } from "@/features/documents/NewVersionDialog";
import { DocumentVersion } from "@/types";

type MoreTab = "versions" | "intelligence" | "security";

export function DocumentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { hasPermission } = useAuth();
  const { notify } = useToast();
  const qc = useQueryClient();
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<any | null>(null);
  const [versionOpen, setVersionOpen] = useState(false);
  const [moreTab, setMoreTab] = useState<MoreTab>("versions");

  const { data, isLoading, error } = useQuery({
    queryKey: ["document", id],
    queryFn: async () => (await api.get(`/documents/${id}`)).data.document,
    enabled: !!id,
  });

  if (isLoading) return <DetailSkeleton />;
  if (error || !data) return <ErrorState message="This document could not be loaded. You may not have access to it." />;

  const versions: DocumentVersion[] = data.versions ?? [];
  const current = versions[0];
  const Icon = fileIcon(current?.mimeType);
  const caseLink = `/cases/${data.caseId}?tab=documents`;
  const canDownload = hasPermission("document.download");

  async function handleVerify() {
    setVerifying(true);
    setVerifyResult(null);
    try {
      const { data: result } = await api.post(`/documents/${id}/verify`, {});
      setVerifyResult(result);
      qc.invalidateQueries({ queryKey: ["document", id] });
      if (result.status === "VERIFIED") notify("Integrity verified", "success", "The stored file matches its registered SHA-256 hash.");
      else notify("Integrity violation detected", "danger", "The stored file no longer matches its registered hash.");
    } catch (err) {
      notify("Verification failed", "danger", normalizeApiError(err).message);
    } finally {
      setVerifying(false);
    }
  }

  async function handleDownload() {
    try {
      await downloadFile(`/documents/${id}/download`, current?.fileName ?? "document");
    } catch (err: any) {
      notify("Download failed", "danger", err?.message);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Breadcrumbs items={[{ label: "Cases", to: "/cases" }, { label: data.case?.caseNumber ?? "Case", to: caseLink }, { label: data.documentNumber }]} />
        <Link to={caseLink} className="btn-ghost btn-sm -mt-3">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to case
        </Link>
      </div>

      <section className="card p-6">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="flex min-w-0 items-start gap-4">
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-teal/10 text-teal">
              <Icon className="h-6 w-6" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="font-mono text-sm font-medium text-teal-dark">{data.documentNumber}</p>
              <h1 className="mt-0.5 break-words text-2xl font-semibold tracking-tight text-ink">{data.title}</h1>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <span className="rounded-md border border-navy-100 bg-navy-50 px-2 py-0.5 text-xs font-medium text-navy-600">{documentTypeLabel(data.type)}</span>
                <span className="rounded-md bg-navy-50 px-2 py-0.5 font-mono text-xs font-medium text-navy-600">v{current?.versionNumber ?? 1}</span>
                <StatusBadge status={current?.integrityStatus ?? "UNVERIFIED"} />
                <span className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-0.5 text-xs font-medium text-ink-muted">
                  <Lock className="h-3.5 w-3.5" aria-hidden="true" /> {sentence(data.confidentiality)}
                </span>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {canDownload && (
              <button className="btn-secondary" onClick={handleDownload}>
                <Download className="h-4 w-4" /> Download
              </button>
            )}
            {hasPermission("document.version") && (
              <button className="btn-primary" onClick={() => setVersionOpen(true)}>
                <UploadCloud className="h-4 w-4" /> Upload new version
              </button>
            )}
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="flex flex-col xl:col-span-2">
          <PreviewPanel documentId={data.id} version={current} canPreview={canDownload} />
        </div>

        <div className="space-y-5">
          <IntegrityCard
            version={current}
            verifying={verifying}
            verifyResult={verifyResult}
            onVerify={hasPermission("document.verify") ? handleVerify : undefined}
          />
          <section className="card p-5">
            <h2 className="section-title mb-4">Document details</h2>
            <dl className="space-y-3 text-sm">
              <Row label="Document type" value={documentTypeLabel(data.type)} />
              <Row
                label="Case"
                value={
                  <Link to={caseLink} className="font-medium text-teal hover:underline">
                    {data.case?.caseNumber}
                  </Link>
                }
              />
              <Row label="Version" value={`v${current?.versionNumber ?? 1} of ${versions.length}`} />
              <Row label="Uploaded by" value={current?.uploader?.fullName ?? "—"} />
              <Row label="Created" value={formatDateTime(data.createdAt)} />
              <Row label="Updated" value={formatDateTime(current?.uploadedAt ?? data.updatedAt)} />
              <Row label="File" value={<span className="break-all">{current?.fileName ?? "—"}</span>} />
              <Row label="Size" value={current ? formatFileSize(current.fileSize) : "—"} />
              <Row label="Audit events" value={String(data.auditEventCount ?? 0)} />
            </dl>
            {data.description && <p className="mt-4 border-t border-border pt-4 text-sm text-ink-muted">{data.description}</p>}
          </section>
        </div>
      </div>

      <section className="card">
        <div role="tablist" aria-label="More document information" className="flex gap-1 overflow-x-auto border-b border-border px-3">
          {(
            [
              { key: "versions", label: "Version history", icon: History, count: versions.length },
              { key: "intelligence", label: "Document intelligence", icon: Sparkles },
              { key: "security", label: "Security & sharing", icon: ShieldCheck },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={moreTab === t.key}
              onClick={() => setMoreTab(t.key)}
              className={clsx(
                "-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-3 text-sm font-medium",
                moreTab === t.key ? "border-teal text-teal-dark" : "border-transparent text-ink-muted hover:text-ink",
              )}
            >
              <t.icon className="h-4 w-4" aria-hidden="true" /> {t.label}
              {"count" in t && <span className="rounded-full bg-navy-50 px-1.5 text-[11px] text-ink-subtle">{t.count}</span>}
            </button>
          ))}
        </div>
        <div className="p-5">
          {moreTab === "versions" && <VersionList versions={versions} />}
          {moreTab === "intelligence" && (
            <div className="-m-5 [&>section]:rounded-none [&>section]:border-0 [&>section]:shadow-none">
              <DocumentIntelligencePanel documentId={data.id} />
            </div>
          )}
          {moreTab === "security" && (
            <DocumentSecurityPanel document={{ id: data.id, title: data.title, documentNumber: data.documentNumber, confidentiality: data.confidentiality, caseId: data.caseId }} />
          )}
        </div>
      </section>

      <NewVersionDialog open={versionOpen} documentId={data.id} currentVersion={current?.versionNumber ?? 1} onClose={() => setVersionOpen(false)} />
    </div>
  );
}

function IntegrityCard({
  version,
  verifying,
  verifyResult,
  onVerify,
}: {
  version?: DocumentVersion;
  verifying: boolean;
  verifyResult: any | null;
  onVerify?: () => void;
}) {
  const [showFull, setShowFull] = useState(false);
  const [copied, setCopied] = useState(false);
  const status = verifyResult?.status ?? version?.integrityStatus ?? "UNVERIFIED";
  const tone =
    status === "VERIFIED"
      ? { box: "border-success/25 bg-success-bg", text: "text-success", icon: ShieldCheck, label: "INTEGRITY VERIFIED" }
      : status === "VIOLATION"
        ? { box: "border-danger/25 bg-danger-bg", text: "text-danger", icon: ShieldAlert, label: "INTEGRITY VIOLATION" }
        : { box: "border-warning/25 bg-warning-bg", text: "text-warning", icon: ShieldQuestion, label: "NOT YET VERIFIED" };
  const hash = version?.sha256Hash ?? "";

  async function copy() {
    try {
      await navigator.clipboard.writeText(hash);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setShowFull(true);
    }
  }

  return (
    <section className="card p-5">
      <h2 className="section-title mb-4">Integrity</h2>
      <div className={clsx("flex items-center gap-3 rounded-lg border px-4 py-3.5", tone.box)}>
        <tone.icon className={clsx("h-7 w-7 flex-shrink-0", tone.text)} aria-hidden="true" />
        <div>
          <p className={clsx("text-sm font-bold tracking-wide", tone.text)}>{tone.label}</p>
          <p className="text-xs text-ink-muted">
            {status === "VERIFIED"
              ? "The stored file matches its registered SHA-256 hash."
              : status === "VIOLATION"
                ? "The stored file does not match its registered hash."
                : "Run a verification to compare the stored file with its hash."}
          </p>
        </div>
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between">
          <p className="eyebrow">SHA-256 fingerprint</p>
          <div className="flex gap-1">
            <button onClick={() => setShowFull((v) => !v)} className="rounded p-1 text-ink-subtle hover:bg-navy-50 hover:text-ink" aria-label={showFull ? "Show shortened hash" : "Show full hash"} title={showFull ? "Shorten" : "Show full hash"}>
              {showFull ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
            <button onClick={copy} className="rounded p-1 text-ink-subtle hover:bg-navy-50 hover:text-ink" aria-label="Copy full hash" title="Copy full hash">
              {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
        <p className={clsx("mt-1.5 rounded-md bg-surface px-3 py-2 font-mono text-xs text-ink", showFull ? "break-all" : "truncate")} title={hash}>
          {showFull ? hash : truncateHash(hash, 12)}
        </p>
        {verifyResult && verifyResult.currentHash !== verifyResult.registeredHash && (
          <p className="mt-2 break-all font-mono text-[11px] text-danger">Current: {verifyResult.currentHash}</p>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-xs text-ink-subtle">Last verified {verifyResult ? "just now" : version?.lastVerifiedAt ? formatDateTime(version.lastVerifiedAt) : "never"}</p>
        {onVerify && (
          <button className="btn-secondary btn-sm flex-shrink-0 whitespace-nowrap" onClick={onVerify} disabled={verifying}>
            {verifying ? <Spinner className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />} {verifying ? "Verifying…" : "Verify now"}
          </button>
        )}
      </div>
    </section>
  );
}

function PreviewPanel({ documentId, version, canPreview }: { documentId: string; version?: DocumentVersion; canPreview: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previewable = isPreviewable(version?.mimeType);

  // Revoke blob URLs when the preview is closed or the version changes.
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);
  useEffect(() => {
    setUrl(null);
    setText(null);
    setError(null);
  }, [version?.id]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const { blob } = await fetchBlob(`/documents/${documentId}/download`);
      if (version?.mimeType === "text/plain") setText(await blob.text());
      else setUrl(URL.createObjectURL(new Blob([blob], { type: version?.mimeType })));
    } catch (err: any) {
      setError(err?.message ?? "The preview could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  const open = !!url || text !== null;

  return (
    <section className="card flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
        <h2 className="section-title flex items-center gap-2">
          <Eye className="h-4 w-4 text-ink-subtle" aria-hidden="true" /> Preview
        </h2>
        {open && (
          <button
            className="btn-ghost btn-sm"
            onClick={() => {
              setUrl(null);
              setText(null);
            }}
          >
            <EyeOff className="h-3.5 w-3.5" /> Hide preview
          </button>
        )}
      </div>
      {open ? (
        <div className="bg-navy-50/50">
          {url && version?.mimeType === "application/pdf" && <iframe title="Document preview" src={url} className="h-[640px] w-full border-0 bg-white" />}
          {url && version?.mimeType.startsWith("image/") && (
            <div className="flex max-h-[640px] justify-center overflow-auto p-6">
              <img src={url} alt={version.fileName} className="max-w-full rounded border border-border bg-white shadow-card" />
            </div>
          )}
          {text !== null && <pre className="max-h-[640px] overflow-auto whitespace-pre-wrap bg-white p-6 font-mono text-xs leading-relaxed text-ink">{text}</pre>}
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center bg-surface/40 px-6 py-16 text-center">
          <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-white shadow-card">
            <Eye className="h-6 w-6 text-navy-400" aria-hidden="true" />
          </div>
          {!previewable ? (
            <>
              <p className="text-sm font-medium text-ink">Preview isn't available for this file type</p>
              <p className="mt-1 text-sm text-ink-muted">Download the file to open it in its native application.</p>
            </>
          ) : !canPreview ? (
            <>
              <p className="text-sm font-medium text-ink">Preview requires download permission</p>
              <p className="mt-1 text-sm text-ink-muted">Your role can view this record's details but not its contents.</p>
            </>
          ) : (
            <>
              <p className="text-sm font-medium text-ink">{version?.fileName}</p>
              <p className="mt-1 text-sm text-ink-muted">The file is loaded securely through the API. Opening it is recorded in the audit trail.</p>
              <button className="btn-primary mt-4" onClick={load} disabled={loading}>
                {loading ? <Spinner /> : <Eye className="h-4 w-4" />} {loading ? "Loading preview…" : "Preview document"}
              </button>
              {error && <p className="mt-3 text-xs text-danger">{error}</p>}
            </>
          )}
        </div>
      )}
    </section>
  );
}

function VersionList({ versions }: { versions: DocumentVersion[] }) {
  return (
    <ol className="space-y-3">
      {versions.map((v, i) => (
        <li key={v.id} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border p-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className={clsx("mt-0.5 rounded px-1.5 py-0.5 font-mono text-xs font-semibold", i === 0 ? "bg-teal text-white" : "bg-navy-50 text-navy-600")}>v{v.versionNumber}</span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-ink">
                {v.fileName}
                {i === 0 && <span className="ml-2 text-xs font-normal text-teal-dark">Current</span>}
              </p>
              <p className="text-xs text-ink-subtle">
                {v.changeNote ?? "Initial registration"} · {v.uploader?.fullName ?? "—"} · {formatDateTime(v.uploadedAt)}
              </p>
              <p className="mt-1 font-mono text-[11px] text-ink-subtle" title={v.sha256Hash}>
                SHA-256 {truncateHash(v.sha256Hash, 10)}
              </p>
            </div>
          </div>
          <StatusBadge status={v.integrityStatus} />
        </li>
      ))}
    </ol>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="flex-shrink-0 text-ink-subtle">{label}</dt>
      <dd className="min-w-0 text-right text-ink">{value}</dd>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-5" role="status" aria-label="Loading document">
      <Skeleton className="h-4 w-64" />
      <Skeleton className="h-32 w-full" />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Skeleton className="h-80 xl:col-span-2" />
        <Skeleton className="h-80" />
      </div>
    </div>
  );
}

const sentence = (v: string) => v.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
