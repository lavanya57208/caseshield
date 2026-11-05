import { ReactNode, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X, LucideIcon } from "lucide-react";
import clsx from "clsx";

const SIZES = { sm: "max-w-md", md: "max-w-lg", lg: "max-w-2xl" } as const;

/**
 * Shared dialog shell: dimmed overlay, Esc / × to close (unless `busy`),
 * initial focus inside the dialog, and a consistent header/footer. Clicking the
 * overlay does NOT close it by default, so a stray click cannot discard a
 * half-filled form; pass `dismissOnOverlay` for purely informational dialogs.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  icon: Icon,
  size = "md",
  busy = false,
  dismissOnOverlay = false,
  footer,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  icon?: LucideIcon;
  size?: keyof typeof SIZES;
  busy?: boolean;
  dismissOnOverlay?: boolean;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const busyRef = useRef(busy);
  busyRef.current = busy;

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const focusable = panelRef.current?.querySelector<HTMLElement>("input:not([disabled]), select, textarea, button[data-autofocus]");
    (focusable ?? panelRef.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busyRef.current) onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      previouslyFocused?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  // Portal to <body>: rendered inline, the overlay would inherit layout
  // spacing (e.g. a parent's space-y margin) and not cover the full viewport.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-navy-900/50 p-4 backdrop-blur-[1px]"
      onMouseDown={(e) => {
        if (dismissOnOverlay && e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        tabIndex={-1}
        className={clsx("flex max-h-[92vh] w-full animate-pop-in flex-col overflow-hidden rounded-xl bg-white shadow-panel outline-none", SIZES[size])}
      >
        <div className="flex items-start gap-3 border-b border-border px-6 py-4">
          {Icon && (
            <div className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-teal/10 text-teal">
              <Icon className="h-5 w-5" aria-hidden="true" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h2 id="modal-title" className="text-base font-semibold text-ink">
              {title}
            </h2>
            {description && <p className="mt-0.5 text-sm text-ink-muted">{description}</p>}
          </div>
          <button onClick={onClose} disabled={busy} aria-label="Close dialog" className="rounded-md p-1 text-ink-subtle hover:bg-navy-50 hover:text-ink disabled:opacity-40">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-border bg-surface/60 px-6 py-3.5">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
