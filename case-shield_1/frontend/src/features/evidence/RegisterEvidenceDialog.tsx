import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, normalizeApiError } from "@/lib/api";
import { useToast } from "@/components/Toast";
import { useAuth } from "@/hooks/useAuth";
import { CustodianCandidate, DocumentSummary, EvidenceItem } from "@/types";
import { EVIDENCE_TYPES, EVIDENCE_TYPE_LABELS } from "@/lib/evidence";
import { EvidenceDialogShell } from "@/features/evidence/EvidenceDialogShell";
import { Fingerprint, Info } from "lucide-react";

const Schema = z.object({
  title: z.string().trim().min(1, "Title is required.").max(200),
  type: z.string().min(1),
  description: z.string().trim().min(1, "Description is required.").max(4000),
  source: z.string().max(200).optional(),
  collectedAt: z.string().min(1, "Collection time is required."),
  collectedById: z.string().optional(),
  initialCustodianId: z.string().optional(),
  location: z.string().max(300).optional(),
  confidentiality: z.enum(["PUBLIC", "INTERNAL", "CONFIDENTIAL", "HIGHLY_CONFIDENTIAL", "RESTRICTED"]),
  documentId: z.string().optional(),
  notes: z.string().max(2000).optional(),
});
type FormValues = z.infer<typeof Schema>;

function nowLocal() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export function RegisterEvidenceDialog({
  open,
  caseId,
  onClose,
  onRegistered,
}: {
  open: boolean;
  caseId: string;
  onClose: () => void;
  onRegistered: (evidence: EvidenceItem) => void;
}) {
  const { notify } = useToast();
  const { user } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(Schema),
    defaultValues: { type: "FORENSIC_REPORT", confidentiality: "CONFIDENTIAL", collectedAt: nowLocal() },
  });
  const confidentiality = watch("confidentiality");

  const { data: candidates } = useQuery({
    queryKey: ["evidence-registration-candidates", caseId, confidentiality],
    queryFn: async () =>
      (await api.get("/evidence/registration-candidates", { params: { caseId, confidentiality } })).data as {
        custodians: CustodianCandidate[];
        collectors: CustodianCandidate[];
      },
    enabled: open,
  });

  const { data: documents } = useQuery({
    queryKey: ["documents", caseId, "for-evidence"],
    queryFn: async () => (await api.get("/documents", { params: { caseId, pageSize: 100 } })).data.items as DocumentSummary[],
    enabled: open,
  });

  if (!open) return null;

  async function onSubmit(values: FormValues) {
    setSubmitting(true);
    try {
      const { data } = await api.post("/evidence", {
        ...values,
        caseId,
        collectedAt: new Date(values.collectedAt).toISOString(),
        collectedById: values.collectedById || undefined,
        initialCustodianId: values.initialCustodianId || undefined,
        documentId: values.documentId || undefined,
      });
      notify(`Evidence ${data.evidence.evidenceNumber} registered.`, "success");
      reset();
      onRegistered(data.evidence);
    } catch (err) {
      notify(normalizeApiError(err).message, "danger");
    } finally {
      setSubmitting(false);
    }
  }

  const person = (c: CustodianCandidate) => `${c.fullName}${c.roles[0] ? ` — ${c.roles[0].name}` : ""}`;

  return (
    <EvidenceDialogShell id="register-evidence-title" title="Register evidence" subtitle="Creates the evidence record and the first entry of its chain of custody." onClose={onClose} wide>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 px-6 py-5" noValidate>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <label className="label" htmlFor="ev-title">Title</label>
            <input id="ev-title" className="input" placeholder="e.g. Forensic Examination Report" {...register("title")} />
            {errors.title && <p className="mt-1 text-xs text-danger">{errors.title.message}</p>}
          </div>
          <div>
            <label className="label" htmlFor="ev-type">Type</label>
            <select id="ev-type" className="input" {...register("type")}>
              {EVIDENCE_TYPES.map((t) => (
                <option key={t} value={t}>{EVIDENCE_TYPE_LABELS[t]}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="label" htmlFor="ev-description">Description</label>
          <textarea id="ev-description" rows={3} className="input" {...register("description")} />
          {errors.description && <p className="mt-1 text-xs text-danger">{errors.description.message}</p>}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="ev-source">Source</label>
            <input id="ev-source" className="input" placeholder="e.g. Forensic Laboratory" {...register("source")} />
          </div>
          <div>
            <label className="label" htmlFor="ev-location">Collection location</label>
            <input id="ev-location" className="input" {...register("location")} />
          </div>
          <div>
            <label className="label" htmlFor="ev-collectedAt">Collected at</label>
            <input id="ev-collectedAt" type="datetime-local" className="input" max={nowLocal()} {...register("collectedAt")} />
            {errors.collectedAt && <p className="mt-1 text-xs text-danger">{errors.collectedAt.message}</p>}
          </div>
          <div>
            <label className="label" htmlFor="ev-collectedBy">Collected by</label>
            <select id="ev-collectedBy" className="input" {...register("collectedById")}>
              <option value="">{user?.fullName ?? "Me"} (you)</option>
              {candidates?.collectors.filter((c) => c.id !== user?.id).map((c) => (
                <option key={c.id} value={c.id}>{person(c)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="ev-custodian">Initial custodian</label>
            <select id="ev-custodian" className="input" {...register("initialCustodianId")}>
              <option value="">{user?.fullName ?? "Me"} (you)</option>
              {candidates?.custodians.filter((c) => c.id !== user?.id).map((c) => (
                <option key={c.id} value={c.id}>{person(c)}</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-ink-subtle">Only case members authorized to hold evidence are listed.</p>
          </div>
          <div>
            <label className="label" htmlFor="ev-confidentiality">Confidentiality</label>
            <select id="ev-confidentiality" className="input" {...register("confidentiality")}>
              <option value="PUBLIC">Public</option>
              <option value="INTERNAL">Internal</option>
              <option value="CONFIDENTIAL">Confidential</option>
              <option value="HIGHLY_CONFIDENTIAL">Highly Confidential</option>
              <option value="RESTRICTED">Restricted</option>
            </select>
          </div>
        </div>

        <div className="rounded-md border border-border bg-surface p-4">
          <label className="label flex items-center gap-1.5" htmlFor="ev-document">
            <Fingerprint className="h-4 w-4 text-teal" aria-hidden="true" /> Attached digital file (optional)
          </label>
          <select id="ev-document" className="input" {...register("documentId")}>
            <option value="">No digital file — physical or metadata-only evidence</option>
            {documents?.map((d) => (
              <option key={d.id} value={d.id}>{d.documentNumber} · {d.title}</option>
            ))}
          </select>
          <p className="mt-1.5 flex items-start gap-1.5 text-xs text-ink-subtle">
            <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
            The file is referenced, not copied. Its current version is pinned and its SHA-256 recalculated from storage at registration.
          </p>
        </div>

        <div>
          <label className="label" htmlFor="ev-notes">Notes (optional)</label>
          <textarea id="ev-notes" rows={2} className="input" {...register("notes")} />
        </div>

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={submitting}>{submitting ? "Registering…" : "Register evidence"}</button>
        </div>
      </form>
    </EvidenceDialogShell>
  );
}
