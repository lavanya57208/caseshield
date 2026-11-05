import { ShieldCheck } from "lucide-react";

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-teal">
        <ShieldCheck className="h-5 w-5 text-white" aria-hidden="true" />
      </div>
      {!compact && (
        <div className="leading-tight">
          <p className="text-sm font-bold tracking-wide text-white">CASE SHIELD</p>
          <p className="text-[10px] uppercase tracking-widest text-navy-300">Secure Case &amp; Document Management</p>
        </div>
      )}
    </div>
  );
}
