import { createContext, useCallback, useContext, useState, ReactNode } from "react";
import { CheckCircle2, XCircle, Info, AlertTriangle, X } from "lucide-react";
import clsx from "clsx";

type Tone = "success" | "danger" | "info" | "warning";

interface ToastMessage {
  id: number;
  tone: Tone;
  message: string;
  detail?: string;
}

interface ToastContextValue {
  /** One consistent notification style for the whole app. `detail` is an optional second line. */
  notify: (message: string, tone?: Tone, detail?: string) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

let idCounter = 0;

const ICONS: Record<Tone, typeof CheckCircle2> = { success: CheckCircle2, danger: XCircle, info: Info, warning: AlertTriangle };
const ACCENTS: Record<Tone, string> = {
  success: "border-l-success text-success",
  danger: "border-l-danger text-danger",
  info: "border-l-teal text-teal",
  warning: "border-l-warning text-warning",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const notify = useCallback((message: string, tone: Tone = "info", detail?: string) => {
    const id = ++idCounter;
    setToasts((prev) => [...prev.slice(-3), { id, tone, message, detail }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), tone === "danger" ? 7000 : 4500);
  }, []);

  const dismiss = (id: number) => setToasts((prev) => prev.filter((t) => t.id !== id));

  return (
    <ToastContext.Provider value={{ notify }}>
      {children}
      <div className="pointer-events-none fixed bottom-5 right-5 z-[60] flex w-[360px] max-w-[calc(100vw-2.5rem)] flex-col gap-2" aria-live="polite">
        {toasts.map((t) => {
          const Icon = ICONS[t.tone];
          return (
            <div
              key={t.id}
              role={t.tone === "danger" ? "alert" : "status"}
              className={clsx("pointer-events-auto flex animate-slide-in items-start gap-3 rounded-lg border border-l-4 border-border bg-white px-4 py-3 shadow-panel", ACCENTS[t.tone])}
            >
              <Icon className="mt-0.5 h-4.5 w-4.5 flex-shrink-0" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink">{t.message}</p>
                {t.detail && <p className="mt-0.5 text-xs text-ink-muted">{t.detail}</p>}
              </div>
              <button onClick={() => dismiss(t.id)} className="text-ink-subtle hover:text-ink" aria-label="Dismiss notification">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
