import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, normalizeApiError } from "@/lib/api";
import { useToast } from "@/components/Toast";
import { useAuth } from "@/hooks/useAuth";
import { StatusBadge } from "@/components/StatusBadge";
import { AccessRequest } from "@/types";
import { formatDate } from "@/lib/format";
import { Plus, Check, X as XIcon } from "lucide-react";

const PERMISSION_OPTIONS = [
  "document.view", "document.download", "document.share", "evidence.view", "evidence.transfer", "audit.view",
];

const RequestSchema = z.object({
  permissionKey: z.string().min(1),
  reason: z.string().min(1, "Reason is required."),
  durationDays: z.coerce.number().min(1).max(365).optional(),
});
type RequestForm = z.infer<typeof RequestSchema>;

export function CaseAccessTab({ caseId }: { caseId: string }) {
  const { hasPermission } = useAuth();
  const { notify } = useToast();
  const qc = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["access-requests", caseId],
    queryFn: async () => (await api.get("/access-requests", { params: { caseId } })).data as { items: AccessRequest[] },
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<RequestForm>({ resolver: zodResolver(RequestSchema) });

  async function onSubmit(values: RequestForm) {
    try {
      await api.post("/access-requests", { ...values, caseId });
      notify("Access request submitted.", "success");
      reset();
      setFormOpen(false);
      qc.invalidateQueries({ queryKey: ["access-requests", caseId] });
    } catch (err) {
      notify(normalizeApiError(err).message, "danger");
    }
  }

  async function review(id: string, action: "approve" | "reject") {
    try {
      await api.post(`/access-requests/${id}/${action}`, {});
      notify(`Request ${action === "approve" ? "approved" : "rejected"}.`, "success");
      qc.invalidateQueries({ queryKey: ["access-requests", caseId] });
    } catch (err) {
      notify(normalizeApiError(err).message, "danger");
    }
  }

  const canApprove = hasPermission("access.approve");

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-ink-muted">Requests to access this case or its documents beyond your baseline role.</p>
        {hasPermission("access.request") && (
          <button className="btn-primary" onClick={() => setFormOpen((v) => !v)}>
            <Plus className="h-4 w-4" /> Request access
          </button>
        )}
      </div>

      {formOpen && (
        <form onSubmit={handleSubmit(onSubmit)} className="card space-y-4 p-5" noValidate>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label" htmlFor="permissionKey">Permission requested</label>
              <select id="permissionKey" className="input" {...register("permissionKey")}>
                {PERMISSION_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="durationDays">Duration (days, optional)</label>
              <input id="durationDays" type="number" min={1} max={365} className="input" {...register("durationDays")} />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="reason">Reason</label>
            <textarea id="reason" rows={2} className="input" {...register("reason")} />
            {errors.reason && <p className="mt-1 text-xs text-danger">{errors.reason.message}</p>}
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setFormOpen(false)}>Cancel</button>
            <button type="submit" className="btn-primary">Submit request</button>
          </div>
        </form>
      )}

      <div className="card overflow-hidden">
        {isLoading ? (
          <p className="p-4 text-sm text-ink-subtle">Loading…</p>
        ) : (data?.items.length ?? 0) === 0 ? (
          <p className="p-4 text-sm text-ink-subtle">No access requests for this case yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-navy-50/50 text-left">
                <th className="px-4 py-3 font-semibold text-ink-muted">Requested by</th>
                <th className="px-4 py-3 font-semibold text-ink-muted">Permission</th>
                <th className="px-4 py-3 font-semibold text-ink-muted">Reason</th>
                <th className="px-4 py-3 font-semibold text-ink-muted">Status</th>
                <th className="px-4 py-3 font-semibold text-ink-muted">Requested</th>
                {canApprove && <th className="px-4 py-3 font-semibold text-ink-muted">Review</th>}
              </tr>
            </thead>
            <tbody>
              {data!.items.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3">{r.requestedBy?.fullName}</td>
                  <td className="px-4 py-3 font-mono text-xs">{r.permissionKey}</td>
                  <td className="max-w-xs px-4 py-3 text-ink-muted">{r.reason}</td>
                  <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                  <td className="px-4 py-3 text-ink-subtle">{formatDate(r.createdAt)}</td>
                  {canApprove && (
                    <td className="px-4 py-3">
                      {r.status === "PENDING" ? (
                        <div className="flex gap-1.5">
                          <button onClick={() => review(r.id, "approve")} className="rounded-md bg-success-bg p-1.5 text-success hover:bg-success/20" aria-label="Approve request">
                            <Check className="h-4 w-4" />
                          </button>
                          <button onClick={() => review(r.id, "reject")} className="rounded-md bg-danger-bg p-1.5 text-danger hover:bg-danger/20" aria-label="Reject request">
                            <XIcon className="h-4 w-4" />
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-ink-subtle">—</span>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
