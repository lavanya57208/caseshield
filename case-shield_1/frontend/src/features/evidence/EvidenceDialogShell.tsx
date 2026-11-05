import { createPortal } from "react-dom";
import { ReactNode, useEffect } from "react";
import { X } from "lucide-react";

// Shared frame for evidence dialogs — same look as the existing Case Shield
// dialogs (RegisterEvidence, SecureShare), with Escape-to-close.
export function EvidenceDialogShell({
  id,
  title,
  subtitle,
  onClose,
  children,
  wide,
}: {
  id: string;
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Portal so layout spacing on the page never offsets the overlay.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-900/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        className={`max-h-[90vh] w-full overflow-y-auto rounded-lg bg-white shadow-panel ${wide ? "max-w-2xl" : "max-w-lg"}`}
      >
        <div className="flex items-start justify-between border-b border-border px-6 py-4">
          <div>
            <h2 id={id} className="text-base font-semibold uppercase tracking-wide text-ink">
              {title}
            </h2>
            {subtitle && <div className="mt-0.5 text-xs text-ink-subtle">{subtitle}</div>}
          </div>
          <button onClick={onClose} aria-label="Close dialog" className="text-ink-subtle hover:text-ink">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
