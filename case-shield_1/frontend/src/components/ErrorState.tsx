import { AlertTriangle } from "lucide-react";

export function ErrorState({ message }: { message: string }) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-lg border border-danger/20 bg-danger-bg p-4">
      <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-danger" aria-hidden="true" />
      <div>
        <p className="text-sm font-medium text-danger">Something went wrong</p>
        <p className="mt-0.5 text-sm text-ink-muted">{message}</p>
      </div>
    </div>
  );
}
