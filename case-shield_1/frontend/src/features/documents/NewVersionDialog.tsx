import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, History, UploadCloud } from "lucide-react";
import { api, normalizeApiError } from "@/lib/api";
import { useToast } from "@/components/Toast";
import { Modal } from "@/components/Modal";
import { Spinner } from "@/components/Spinner";
import { formatFileSize } from "@/lib/format";
import { ACCEPT, FileCard, MAX_BYTES, Stage, mimeFor } from "@/features/documents/UploadDocumentDialog";

/** Appends a new immutable version; earlier versions and their hashes are kept. */
export function NewVersionDialog({ open, documentId, currentVersion, onClose }: { open: boolean; documentId: string; currentVersion: number; onClose: () => void }) {
  const { notify } = useToast();
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>("form");
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (open) {
      setFile(null);
      setNote("");
      setError(null);
      setStage("form");
      setProgress(0);
    }
  }, [open]);

  const busy = stage === "uploading" || stage === "securing";

  function pick(f?: File | null) {
    if (!f) return;
    if (!mimeFor(f)) return setError(`"${f.name}" is not a supported format. Use PDF, JPG, PNG or DOCX.`);
    if (f.size === 0 || f.size > MAX_BYTES) return setError(f.size === 0 ? "The selected file is empty." : `The file is ${formatFileSize(f.size)}; the limit is 100 MB.`);
    setError(null);
    setFile(f);
  }

  async function submit() {
    if (!file) return setError("Choose the file for the new version.");
    if (!note.trim()) return setError("Describe what changed in this version.");
    setStage("uploading");
    try {
      const form = new FormData();
      form.append("file", new File([file], file.name, { type: mimeFor(file)! }));
      form.append("changeNote", note.trim());
      const { data } = await api.post(`/documents/${documentId}/versions`, form, {
        onUploadProgress: (evt) => {
          const pct = evt.total ? Math.round((evt.loaded / evt.total) * 100) : 0;
          setProgress(pct);
          if (pct >= 100) setStage("securing");
        },
      });
      notify(`Version ${data.version.versionNumber} uploaded`, "success", "New SHA-256 recorded; earlier versions are preserved.");
      qc.invalidateQueries({ queryKey: ["document", documentId] });
      qc.invalidateQueries({ queryKey: ["document-versions", documentId] });
      qc.invalidateQueries({ queryKey: ["document-intelligence", documentId] });
      onClose();
    } catch (err) {
      setStage("form");
      notify("Version upload failed", "danger", normalizeApiError(err).message);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={busy}
      icon={History}
      title="Upload new version"
      description={`Creates version ${currentVersion + 1}. Version ${currentVersion} and its hash remain unchanged.`}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn-primary min-w-[150px]" onClick={submit} disabled={busy}>
            {busy ? (
              <>
                <Spinner /> {stage === "uploading" ? `Uploading ${progress}%` : "Securing…"}
              </>
            ) : (
              <>
                <UploadCloud className="h-4 w-4" /> Upload version
              </>
            )}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {file ? (
          <FileCard file={file} progress={progress} stage={stage} onRemove={busy ? undefined : () => setFile(null)} />
        ) : (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              pick(e.dataTransfer.files?.[0]);
            }}
            className="flex w-full flex-col items-center rounded-lg border-2 border-dashed border-border-strong bg-surface px-6 py-7 text-center hover:border-teal hover:bg-teal/5"
          >
            <UploadCloud className="mb-2 h-6 w-6 text-teal" aria-hidden="true" />
            <span className="text-sm font-medium text-ink">Drag the revised file here or browse</span>
            <span className="mt-1 text-xs text-ink-subtle">PDF, JPG, PNG, DOCX · up to 100 MB</span>
          </button>
        )}
        <input ref={inputRef} type="file" accept={ACCEPT} className="sr-only" tabIndex={-1} onChange={(e) => pick(e.target.files?.[0])} />
        <label className="block">
          <span className="label">
            Change note<span className="ml-0.5 text-danger">*</span>
          </span>
          <textarea rows={2} className="input" value={note} disabled={busy} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Corrected annexure page numbers" />
        </label>
        {error && (
          <p className="field-error" role="alert">
            <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" /> {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
