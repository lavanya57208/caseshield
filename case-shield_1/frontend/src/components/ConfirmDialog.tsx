import { createPortal } from "react-dom";
import { ReactNode, useEffect, useRef } from "react";
import { AlertTriangle } from "lucide-react";

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  tone = "primary",
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  tone?: "primary" | "danger";
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) ref.current?.focus();
  }, [open]);

  if (!open) return null;

  // Portal so layout spacing on the page never offsets the overlay.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-900/40 p-4" role="presentation">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="w-full max-w-md rounded-lg bg-white p-6 shadow-panel"
      >
        <div className="flex items-start gap-3">
          {tone === "danger" && (
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-danger-bg">
              <AlertTriangle className="h-5 w-5 text-danger" aria-hidden="true" />
            </div>
          )}
          <div>
            <h2 id="confirm-dialog-title" className="text-base font-semibold text-ink">
              {title}
            </h2>
            <div className="mt-1.5 text-sm text-ink-muted">{description}</div>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button className="btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button ref={ref} className={tone === "danger" ? "btn-danger" : "btn-primary"} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
