import { useEffect, useRef, useState, DragEvent, ReactNode } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import clsx from "clsx";
import { AlertCircle, CheckCircle2, FileImage, FileText, FileType2, Fingerprint, FolderCheck, Sparkles, UploadCloud, X } from "lucide-react";
import { api, normalizeApiError } from "@/lib/api";
import { useToast } from "@/components/Toast";
import { Modal } from "@/components/Modal";
import { Spinner } from "@/components/Spinner";
import { formatFileSize, truncateHash } from "@/lib/format";
import { CaseSummary, DocumentIntelligenceResponse } from "@/types";

export const DOC_TYPES: { value: string; label: string }[] = [
  { value: "FIR", label: "FIR" },
  { value: "FORENSIC_REPORT", label: "Forensic report" },
  { value: "WITNESS_STATEMENT", label: "Witness statement" },
  { value: "INVESTIGATION_REPORT", label: "Investigation report" },
  { value: "CHARGE_SHEET", label: "Charge sheet" },
  { value: "COURT_FILING", label: "Court filing" },
  { value: "EVIDENCE_RECORD", label: "Evidence record" },
  { value: "LEGAL_NOTICE", label: "Legal notice" },
  { value: "JUDGMENT", label: "Judgment" },
  { value: "ORDER", label: "Order" },
  { value: "SUPPORTING_DOCUMENT", label: "Supporting document" },
];

// Mirrors the server's allow-list (backend/src/modules/documents/file-validation.ts).
const EXTENSION_MIME: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  tif: "image/tiff",
  tiff: "image/tiff",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  txt: "text/plain",
};
export const ACCEPT = Object.keys(EXTENSION_MIME).map((e) => `.${e}`).join(",");
export const MAX_BYTES = 100 * 1024 * 1024;

export function mimeFor(file: File) {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_MIME[ext] ? (file.type && Object.values(EXTENSION_MIME).includes(file.type) ? file.type : EXTENSION_MIME[ext]) : null;
}

function fileKindLabel(mime: string | null) {
  if (!mime) return "Unsupported";
  if (mime === "application/pdf") return "PDF document";
  if (mime.startsWith("image/")) return `${mime.split("/")[1].toUpperCase()} image`;
  if (mime.includes("word")) return "Word document";
  return "Text file";
}

/** Suggests a document type from the file name (the user can change it). */
function guessType(name: string) {
  const n = name.toLowerCase();
  if (/\bfir\b|first.?information/.test(n)) return "FIR";
  if (/forensic|lab/.test(n)) return "FORENSIC_REPORT";
  if (/witness|statement/.test(n)) return "WITNESS_STATEMENT";
  if (/charge/.test(n)) return "CHARGE_SHEET";
  if (/judg/.test(n)) return "JUDGMENT";
  if (/order/.test(n)) return "ORDER";
  if (/notice/.test(n)) return "LEGAL_NOTICE";
  if (/investigation|report/.test(n)) return "INVESTIGATION_REPORT";
  return "SUPPORTING_DOCUMENT";
}

const Schema = z.object({
  caseId: z.string().min(1, "Select the case this document belongs to."),
  title: z.string().trim().min(1, "Enter a document title.").max(300),
  type: z.string().min(1),
  description: z.string().max(2000).optional(),
  confidentiality: z.enum(["PUBLIC", "INTERNAL", "CONFIDENTIAL", "HIGHLY_CONFIDENTIAL", "RESTRICTED"]),
});
type FormValues = z.infer<typeof Schema>;

export type Stage = "form" | "uploading" | "securing" | "done";

interface UploadResult {
  id: string;
  documentNumber: string;
  title: string;
  caseNumber?: string;
  sha256Hash: string;
  versionNumber: number;
}

export function UploadDocumentDialog({
  open,
  caseId,
  caseNumber,
  onClose,
  onUploaded,
}: {
  open: boolean;
  /** When omitted, the dialog asks which case to upload into. */
  caseId?: string;
  caseNumber?: string;
  onClose: () => void;
  onUploaded?: (documentId: string) => void;
}) {
  const { notify } = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState<Stage>("form");
  const [result, setResult] = useState<UploadResult | null>(null);

  const cases = useQuery({
    queryKey: ["cases", "upload-picker"],
    queryFn: async () => (await api.get("/cases", { params: { pageSize: 100 } })).data.items as CaseSummary[],
    enabled: open && !caseId,
  });

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(Schema),
    defaultValues: { caseId: caseId ?? "", confidentiality: "CONFIDENTIAL", type: "SUPPORTING_DOCUMENT", title: "" },
  });

  useEffect(() => {
    if (open) {
      reset({ caseId: caseId ?? "", confidentiality: "CONFIDENTIAL", type: "SUPPORTING_DOCUMENT", title: "", description: "" });
      setFile(null);
      setFileError(null);
      setProgress(0);
      setStage("form");
      setResult(null);
    }
  }, [open, caseId, reset]);

  const busy = stage === "uploading" || stage === "securing";

  function selectFile(f: File | undefined | null) {
    if (!f) return;
    const mime = mimeFor(f);
    if (!mime) {
      setFile(null);
      setFileError(`"${f.name}" is not a supported format. Use PDF, JPG, PNG or DOCX.`);
      return;
    }
    if (f.size === 0) {
      setFileError("The selected file is empty.");
      return;
    }
    if (f.size > MAX_BYTES) {
      setFileError(`The file is ${formatFileSize(f.size)}; the limit is 100 MB.`);
      return;
    }
    setFileError(null);
    setFile(f);
    if (!watch("title")) setValue("title", f.name, { shouldValidate: true });
    setValue("type", guessType(f.name));
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (!busy) selectFile(e.dataTransfer.files?.[0]);
  }

  async function onSubmit(values: FormValues) {
    if (!file) {
      setFileError("Choose a file to upload.");
      return;
    }
    setStage("uploading");
    setProgress(0);
    try {
      const mime = mimeFor(file)!;
      const form = new FormData();
      // Re-wrap so the server receives the canonical MIME type even when the browser reports none.
      form.append("file", new File([file], file.name, { type: mime }));
      form.append("caseId", values.caseId);
      form.append("title", values.title);
      form.append("type", values.type);
      form.append("confidentiality", values.confidentiality);
      if (values.description) form.append("description", values.description);

      const { data } = await api.post("/documents", form, {
        onUploadProgress: (evt) => {
          const pct = evt.total ? Math.round((evt.loaded / evt.total) * 100) : 0;
          setProgress(pct);
          // Bytes are sent; the server is now hashing, storing and registering the file.
          if (pct >= 100) setStage("securing");
        },
      });
      const doc = data.document;
      const pickedCase = cases.data?.find((c) => c.id === values.caseId);
      setResult({
        id: doc.id,
        documentNumber: doc.documentNumber,
        title: doc.title,
        caseNumber: caseNumber ?? pickedCase?.caseNumber,
        sha256Hash: doc.currentVersion?.sha256Hash ?? "",
        versionNumber: doc.currentVersion?.versionNumber ?? 1,
      });
      setStage("done");
      notify("Document uploaded successfully", "success", `${doc.documentNumber} · integrity hash recorded`);
      qc.invalidateQueries({ queryKey: ["documents", values.caseId] });
      qc.invalidateQueries({ queryKey: ["case", values.caseId] });
      qc.invalidateQueries({ queryKey: ["case-activity", values.caseId] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      onUploaded?.(doc.id);
    } catch (err) {
      setStage("form");
      notify("Document upload failed", "danger", normalizeApiError(err).message);
    }
  }

  const title = stage === "done" ? "Document secured" : "Upload case document";

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={busy}
      icon={stage === "done" ? CheckCircle2 : UploadCloud}
      title={title}
      description={stage === "done" ? undefined : caseNumber ? `Adding to ${caseNumber}. The file is hashed with SHA-256 on arrival.` : "The file is hashed with SHA-256 on arrival."}
      footer={
        stage === "done" && result ? (
          <>
            <button className="btn-secondary" onClick={onClose}>
              Done
            </button>
            <button
              className="btn-primary"
              data-autofocus
              onClick={() => {
                onClose();
                navigate(`/documents/${result.id}`);
              }}
            >
              Open document
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" form="upload-form" className="btn-primary min-w-[150px]" disabled={busy}>
              {busy ? (
                <>
                  <Spinner /> {stage === "uploading" ? `Uploading ${progress}%` : "Securing…"}
                </>
              ) : (
                <>
                  <UploadCloud className="h-4 w-4" /> Upload document
                </>
              )}
            </button>
          </>
        )
      }
    >
      {stage === "done" && result ? (
        <UploadSuccess result={result} />
      ) : (
        <form id="upload-form" onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          {!file ? (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => inputRef.current?.click()}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
              role="button"
              tabIndex={0}
              aria-label="Choose a file to upload"
              className={clsx(
                "flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-9 text-center transition-colors",
                dragging ? "border-teal bg-teal/5" : fileError ? "border-danger/40 bg-danger-bg/40" : "border-border-strong bg-surface hover:border-teal hover:bg-teal/5",
              )}
            >
              <div className={clsx("mb-3 flex h-12 w-12 items-center justify-center rounded-full", dragging ? "bg-teal text-white" : "bg-white text-teal shadow-card")}>
                <UploadCloud className="h-6 w-6" aria-hidden="true" />
              </div>
              <p className="text-sm font-medium text-ink">Drag and drop your document here</p>
              <p className="mt-1 text-sm text-ink-muted">
                or <span className="font-medium text-teal underline-offset-2 hover:underline">browse files</span>
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-1.5">
                {["PDF", "JPG", "PNG", "DOCX"].map((f) => (
                  <span key={f} className="rounded border border-border bg-white px-2 py-0.5 text-[11px] font-medium text-ink-muted">
                    {f}
                  </span>
                ))}
                <span className="px-1 py-0.5 text-[11px] text-ink-subtle">up to 100 MB</span>
              </div>
            </div>
          ) : (
            <FileCard file={file} progress={progress} stage={stage} onRemove={busy ? undefined : () => setFile(null)} />
          )}
          <input ref={inputRef} type="file" accept={ACCEPT} className="sr-only" tabIndex={-1} onChange={(e) => selectFile(e.target.files?.[0])} onClick={(e) => ((e.target as HTMLInputElement).value = "")} />
          {fileError && (
            <p className="field-error" role="alert">
              <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" /> {fileError}
            </p>
          )}

          <fieldset disabled={busy} className="space-y-4">
            {!caseId && (
              <FormField label="Case" required error={errors.caseId?.message}>
                <select className={clsx("input", errors.caseId && "input-error")} {...register("caseId")}>
                  <option value="">{cases.isLoading ? "Loading cases…" : "Select a case"}</option>
                  {cases.data?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.caseNumber} — {c.title}
                    </option>
                  ))}
                </select>
              </FormField>
            )}
            <FormField label="Document title" required error={errors.title?.message}>
              <input className={clsx("input", errors.title && "input-error")} placeholder="e.g. Forensic_Report.pdf" {...register("title")} />
            </FormField>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="Document type" required>
                <select className="input" {...register("type")}>
                  {DOC_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label="Confidentiality" required>
                <select className="input" {...register("confidentiality")}>
                  <option value="PUBLIC">Public</option>
                  <option value="INTERNAL">Internal</option>
                  <option value="CONFIDENTIAL">Confidential</option>
                  <option value="HIGHLY_CONFIDENTIAL">Highly confidential</option>
                  <option value="RESTRICTED">Restricted</option>
                </select>
              </FormField>
            </div>
            <FormField label="Description">
              <textarea rows={2} className="input resize-y" placeholder="Optional context, e.g. who prepared it and when." {...register("description")} />
            </FormField>
          </fieldset>
        </form>
      )}
    </Modal>
  );
}

export function FileCard({ file, progress, stage, onRemove }: { file: File; progress: number; stage: Stage; onRemove?: () => void }) {
  const mime = mimeFor(file);
  const Icon = mime?.startsWith("image/") ? FileImage : mime?.includes("word") ? FileType2 : FileText;
  const active = stage === "uploading" || stage === "securing";
  return (
    <div className="rounded-lg border border-border bg-white p-4 shadow-card">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-teal/10 text-teal">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink">{file.name}</p>
          <p className="text-xs text-ink-subtle">
            {formatFileSize(file.size)} · {fileKindLabel(mime)}
          </p>
        </div>
        {onRemove && (
          <button type="button" onClick={onRemove} className="rounded-md p-1.5 text-ink-subtle hover:bg-danger-bg hover:text-danger" aria-label="Remove file">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {active && (
        <div className="mt-3">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-navy-50" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
            <div className={clsx("h-full rounded-full transition-all duration-300", stage === "securing" ? "animate-pulse bg-success" : "bg-teal")} style={{ width: `${Math.max(progress, 4)}%` }} />
          </div>
          <div className="mt-1.5 flex justify-between text-xs text-ink-subtle">
            <span>{stage === "uploading" ? "Uploading…" : "Securing: computing SHA-256 and registering the version…"}</span>
            <span>{progress}%</span>
          </div>
        </div>
      )}
    </div>
  );
}

function UploadSuccess({ result }: { result: UploadResult }) {
  const { notify } = useToast();
  const notified = useRef(false);
  const intel = useQuery({
    queryKey: ["document-intelligence", result.id],
    queryFn: async () => (await api.get(`/documents/${result.id}/intelligence`)).data as DocumentIntelligenceResponse,
    refetchInterval: (q) => {
      const s = q.state.data?.intelligence?.processing.status;
      return !s || s === "QUEUED" || s === "PROCESSING" ? 1500 : false;
    },
  });
  const status = intel.data?.intelligence?.processing.status;
  const finished = status === "COMPLETED" || status === "PARTIAL" || status === "FAILED";

  useEffect(() => {
    if (finished && !notified.current && status !== "FAILED") {
      notified.current = true;
      notify("Document processing completed", "success", `${result.documentNumber} is indexed and searchable.`);
    }
  }, [finished, status, notify, result.documentNumber]);

  const steps: { label: ReactNode; detail?: ReactNode; icon: typeof CheckCircle2; state: "done" | "active" | "warn" }[] = [
    { label: "Document uploaded", detail: `${result.documentNumber} · version ${result.versionNumber}`, icon: CheckCircle2, state: "done" },
    { label: `Added to case${result.caseNumber ? ` ${result.caseNumber}` : ""}`, icon: FolderCheck, state: "done" },
    {
      label: "Integrity hash generated",
      detail: <span className="font-mono">SHA-256 {truncateHash(result.sha256Hash, 10)}</span>,
      icon: Fingerprint,
      state: "done",
    },
    {
      label: finished ? (status === "FAILED" ? "Text extraction could not complete" : "Processed & indexed for search") : "Processing: extracting text and indexing…",
      detail: finished ? (status === "PARTIAL" ? "Some steps were skipped — see the document page." : undefined) : "Runs in the background; you can close this dialog.",
      icon: Sparkles,
      state: finished ? (status === "COMPLETED" ? "done" : "warn") : "active",
    },
  ];

  return (
    <div>
      <div className="mb-4 rounded-lg border border-success/20 bg-success-bg px-4 py-3">
        <p className="text-sm font-semibold text-success">{result.title}</p>
        <p className="text-xs text-ink-muted">Stored securely. The original file is never modified.</p>
      </div>
      <ol className="space-y-3">
        {steps.map((s, i) => (
          <li key={i} className="flex items-start gap-3">
            <span
              className={clsx(
                "flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full",
                s.state === "done" ? "bg-success text-white" : s.state === "warn" ? "bg-warning-bg text-warning" : "bg-teal/10 text-teal",
              )}
            >
              {s.state === "active" ? <Spinner className="h-3.5 w-3.5" /> : <s.icon className="h-4 w-4" aria-hidden="true" />}
            </span>
            <div className="pt-0.5">
              <p className="text-sm font-medium text-ink">{s.label}</p>
              {s.detail && <p className="text-xs text-ink-subtle">{s.detail}</p>}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function FormField({ label, required, error, children }: { label: string; required?: boolean; error?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label">
        {label}
        {required && (
          <span className="ml-0.5 text-danger" aria-hidden="true">
            *
          </span>
        )}
      </span>
      {children}
      {error && (
        <span className="field-error" role="alert">
          <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" /> {error}
        </span>
      )}
    </label>
  );
}
