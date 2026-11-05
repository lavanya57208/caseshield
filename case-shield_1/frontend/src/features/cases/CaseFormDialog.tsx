import { ReactNode, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, FolderPlus, PencilLine } from "lucide-react";
import clsx from "clsx";
import { api, normalizeApiError } from "@/lib/api";
import { useToast } from "@/components/Toast";
import { useAuth } from "@/hooks/useAuth";
import { Modal } from "@/components/Modal";
import { Spinner } from "@/components/Spinner";
import { AssignableOfficer, CaseCategory, CaseDetail } from "@/types";

const PRIORITIES = [
  { value: "LOW", label: "Low" },
  { value: "MEDIUM", label: "Medium" },
  { value: "HIGH", label: "High" },
  { value: "CRITICAL", label: "Critical" },
] as const;
const STATUSES = [
  { value: "ACTIVE", label: "Active" },
  { value: "UNDER_REVIEW", label: "Under review" },
  { value: "ON_HOLD", label: "On hold" },
  { value: "CLOSED", label: "Closed" },
  { value: "ARCHIVED", label: "Archived" },
] as const;
const CONFIDENTIALITY = [
  { value: "PUBLIC", label: "Public" },
  { value: "INTERNAL", label: "Internal" },
  { value: "CONFIDENTIAL", label: "Confidential" },
  { value: "HIGHLY_CONFIDENTIAL", label: "Highly confidential" },
  { value: "RESTRICTED", label: "Restricted" },
] as const;

const Schema = z.object({
  caseNumber: z.string().trim().regex(/^CASE-\d{4}-\d{5}$/i, "Use the format CASE-2026-00427."),
  title: z.string().trim().min(3, "Enter a title of at least 3 characters.").max(300, "Keep the title under 300 characters."),
  categoryId: z.string().min(1, "Select a category."),
  typeId: z.string().min(1, "Select a case type."),
  court: z.string().trim().min(1, "Enter the court or forum."),
  jurisdiction: z.string().trim().max(200).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  status: z.enum(["ACTIVE", "UNDER_REVIEW", "ON_HOLD", "CLOSED", "ARCHIVED"]),
  confidentiality: z.enum(["PUBLIC", "INTERNAL", "CONFIDENTIAL", "HIGHLY_CONFIDENTIAL", "RESTRICTED"]),
  investigatingOfficerId: z.string().min(1, "Assign an investigating officer."),
  description: z.string().trim().min(10, "Add a short description (at least 10 characters).").max(5000),
});
type FormValues = z.infer<typeof Schema>;

const FIELD_ERRORS: Record<string, keyof FormValues> = {
  CASE_NUMBER_TAKEN: "caseNumber",
  INVALID_CASE_TYPE: "typeId",
  INVALID_OFFICER: "investigatingOfficerId",
};

type Props =
  | { mode: "create"; open: boolean; onClose: () => void; onSaved: (c: { id: string; caseNumber: string }) => void; existing?: undefined }
  | { mode: "edit"; open: boolean; onClose: () => void; onSaved: (c: { id: string; caseNumber: string }) => void; existing: CaseDetail };

export function CaseFormDialog(props: Props) {
  const { mode, open, onClose, onSaved, existing } = props;
  const { notify } = useToast();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [submitting, setSubmitting] = useState(false);

  const categories = useQuery({
    queryKey: ["case-categories"],
    queryFn: async () => (await api.get("/cases/categories")).data.categories as CaseCategory[],
    enabled: open,
    staleTime: 5 * 60_000,
  });
  const officers = useQuery({
    queryKey: ["case-officers"],
    queryFn: async () => (await api.get("/cases/officers")).data.officers as AssignableOfficer[],
    enabled: open,
    staleTime: 5 * 60_000,
  });
  const nextNumber = useQuery({
    queryKey: ["case-next-number"],
    queryFn: async () => (await api.get("/cases/next-number")).data.caseNumber as string,
    enabled: open && mode === "create",
    staleTime: 0,
  });

  const defaults = (): FormValues =>
    existing
      ? {
          caseNumber: existing.caseNumber,
          title: existing.title,
          categoryId: existing.category.id ?? existing.categoryId,
          typeId: existing.type.id ?? existing.typeId,
          court: existing.court,
          jurisdiction: existing.jurisdiction ?? "",
          priority: existing.priority,
          status: existing.status,
          confidentiality: existing.confidentiality,
          investigatingOfficerId: existing.investigatingOfficer?.id ?? "",
          description: existing.description,
        }
      : {
          caseNumber: nextNumber.data ?? "",
          title: "",
          categoryId: "",
          typeId: "",
          court: "",
          jurisdiction: "",
          priority: "MEDIUM",
          status: "ACTIVE",
          confidentiality: "CONFIDENTIAL",
          investigatingOfficerId: user?.id ?? "",
          description: "",
        };

  const {
    register,
    handleSubmit,
    watch,
    reset,
    setValue,
    setError,
    getValues,
    formState: { errors, dirtyFields },
  } = useForm<FormValues>({ resolver: zodResolver(Schema), defaultValues: defaults() });

  // Selects can only display a value once their options exist, so the form is
  // (re)initialised after categories and officers have loaded.
  const ready = !!categories.data && !!officers.data;
  useEffect(() => {
    if (open && ready) reset(defaults());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ready, existing?.id, existing?.updatedAt]);

  // Pre-fill the suggested case number once it arrives, unless the user already typed one.
  useEffect(() => {
    if (mode === "create" && ready && nextNumber.data && !getValues("caseNumber")) setValue("caseNumber", nextNumber.data);
  }, [mode, ready, nextNumber.data, getValues, setValue]);

  const categoryId = watch("categoryId");
  const category = categories.data?.find((c) => c.id === categoryId);
  const description = watch("description") ?? "";

  async function onSubmit(values: FormValues) {
    setSubmitting(true);
    try {
      let saved: { id: string; caseNumber: string };
      if (mode === "create") {
        const { status: _status, ...body } = values;
        const { data } = await api.post("/cases", { ...body, caseNumber: values.caseNumber.toUpperCase(), jurisdiction: values.jurisdiction || undefined });
        saved = data.case;
        notify("Case created successfully", "success", `${saved.caseNumber} · ${values.title}`);
      } else {
        // Send only what changed; the case number is immutable.
        const changed = Object.fromEntries(
          (Object.keys(dirtyFields) as (keyof FormValues)[]).filter((k) => k !== "caseNumber").map((k) => [k, values[k]]),
        );
        if (changed.categoryId && !changed.typeId) changed.typeId = values.typeId;
        if (Object.keys(changed).length === 0) {
          notify("No changes to save", "info");
          onClose();
          return;
        }
        const { data } = await api.patch(`/cases/${existing!.id}`, changed);
        saved = data.case;
        notify("Case updated successfully", "success", `${existing!.caseNumber} · ${Object.keys(changed).length} field${Object.keys(changed).length === 1 ? "" : "s"} changed`);
      }
      qc.invalidateQueries({ queryKey: ["cases"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["case-next-number"] });
      if (mode === "edit") {
        await qc.invalidateQueries({ queryKey: ["case", existing!.id] });
        qc.invalidateQueries({ queryKey: ["case-activity", existing!.id] });
      }
      onSaved(saved);
    } catch (err) {
      const e = normalizeApiError(err);
      const field = FIELD_ERRORS[e.code];
      if (field) setError(field, { message: e.message });
      else notify(mode === "create" ? "Case could not be created" : "Changes could not be saved", "danger", e.message);
    } finally {
      setSubmitting(false);
    }
  }

  const loadingOptions = !ready;

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={submitting}
      size="lg"
      icon={mode === "create" ? FolderPlus : PencilLine}
      title={mode === "create" ? "Create new case" : `Edit case ${existing?.caseNumber}`}
      description={mode === "create" ? "Register a case record. You can add documents and evidence right after." : "Changes are saved to the case record and logged in the audit trail."}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" form="case-form" className="btn-primary min-w-[140px]" disabled={submitting || loadingOptions}>
            {submitting ? (
              <>
                <Spinner /> {mode === "create" ? "Creating…" : "Saving…"}
              </>
            ) : mode === "create" ? (
              "Create case"
            ) : (
              "Save changes"
            )}
          </button>
        </>
      }
    >
      {!ready ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-ink-subtle" role="status">
          {categories.error || officers.error ? (
            <span className="text-danger">The form options could not be loaded. Close the dialog and try again.</span>
          ) : (
            <>
              <Spinner /> Loading form…
            </>
          )}
        </div>
      ) : (
      <form id="case-form" onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Case number" required={mode === "create"} error={errors.caseNumber?.message} hint={mode === "create" ? "Suggested automatically — you can change it." : "Case numbers cannot be changed."}>
            <input
              className={clsx("input font-mono uppercase", errors.caseNumber && "input-error")}
              placeholder={nextNumber.isLoading ? "Loading…" : "CASE-2026-00427"}
              disabled={mode === "edit"}
              {...register("caseNumber")}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Case title" required error={errors.title?.message}>
              <input className={clsx("input", errors.title && "input-error")} placeholder="e.g. State vs. Arun Kumar" {...register("title")} />
            </Field>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Case category" required error={errors.categoryId?.message}>
            <select
              className={clsx("input", errors.categoryId && "input-error")}
              {...register("categoryId", { onChange: () => setValue("typeId", "", { shouldDirty: true }) })}
            >
              <option value="">{categories.isLoading ? "Loading categories…" : "Select a category"}</option>
              {categories.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Case type" required error={errors.typeId?.message}>
            <select className={clsx("input", errors.typeId && "input-error")} disabled={!category} {...register("typeId")}>
              <option value="">{category ? "Select a case type" : "Choose a category first"}</option>
              {category?.types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Court / forum" required error={errors.court?.message}>
            <input className={clsx("input", errors.court && "input-error")} placeholder="e.g. Sessions Court, Fictional District" {...register("court")} />
          </Field>
          <Field label="Jurisdiction" error={errors.jurisdiction?.message}>
            <input className="input" placeholder="e.g. Fictional District (optional)" {...register("jurisdiction")} />
          </Field>
          <Field label="Priority" required>
            <select className="input" {...register("priority")}>
              {PRIORITIES.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>
          {mode === "edit" ? (
            <Field label="Status" required>
              <select className="input" {...register("status")}>
                {STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <Field label="Confidentiality" required hint="Controls who may open the case's records.">
              <select className="input" {...register("confidentiality")}>
                {CONFIDENTIALITY.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <div className="sm:col-span-2">
            <Field label="Assigned investigator" required error={errors.investigatingOfficerId?.message}>
              <select className={clsx("input", errors.investigatingOfficerId && "input-error")} {...register("investigatingOfficerId")}>
                <option value="">{officers.isLoading ? "Loading officers…" : "Select an investigating officer"}</option>
                {officers.data?.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.fullName} — {o.role}
                    {o.id === user?.id ? " (you)" : ""}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </div>

        <Field label="Description" required error={errors.description?.message} hint={`${description.length} / 5000`}>
          <textarea
            rows={4}
            className={clsx("input resize-y", errors.description && "input-error")}
            placeholder="Briefly describe the matter, e.g. the incident, parties involved and current stage."
            {...register("description")}
          />
        </Field>
      </form>
      )}
    </Modal>
  );
}

function Field({ label, required, error, hint, children }: { label: string; required?: boolean; error?: string; hint?: string; children: ReactNode }) {
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
      {error ? (
        <span className="field-error" role="alert">
          <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" /> {error}
        </span>
      ) : (
        hint && <span className="mt-1 block text-xs text-ink-subtle">{hint}</span>
      )}
    </label>
  );
}
