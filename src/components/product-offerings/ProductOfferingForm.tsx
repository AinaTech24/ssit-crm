"use client";

/**
 * Create / edit form for a product / service offering.
 *
 * Sections: Identity · Providers · Regulator + Licenses · Required exams ·
 *           Team · Status / dates · Documents · Remarks
 *
 * Pickers:
 *   - Regulator: enum dropdown
 *   - Licenses: multi-select against active legal_registrations
 *   - Team: multi-select against active users
 *   - Providers + Required exams: free-form chip lists (one per line, comma-sep)
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Save, Loader2, Trash2, Plus, X, ExternalLink } from "lucide-react";
import { SelectField } from "@/components/ui/SelectField";
import { DateField } from "@/components/ui/DateField";

const CATEGORIES = [
  { value: "mutual_funds", label: "Mutual Funds" },
  { value: "insurance_life", label: "Insurance — Life" },
  { value: "insurance_general", label: "Insurance — General" },
  { value: "insurance_health", label: "Insurance — Health" },
  { value: "pms", label: "PMS" },
  { value: "aif", label: "AIF" },
  { value: "bonds", label: "Bonds" },
  { value: "corporate_fd", label: "Corporate FD" },
  { value: "nps", label: "NPS" },
  { value: "equity", label: "Equity" },
  { value: "tax_planning", label: "Tax Planning" },
  { value: "estate_planning", label: "Estate Planning" },
  { value: "advisory", label: "Advisory" },
  { value: "loans", label: "Loans" },
  { value: "real_estate", label: "Real Estate" },
  { value: "international", label: "International Investments" },
  { value: "other", label: "Other" },
];

const REGULATORS = [
  { value: "AMFI", label: "AMFI" },
  { value: "SEBI", label: "SEBI" },
  { value: "IRDAI", label: "IRDAI" },
  { value: "GST", label: "GST" },
  { value: "Income_Tax", label: "Income Tax" },
  { value: "MCA", label: "MCA / ROC" },
  { value: "RBI", label: "RBI" },
  { value: "State_Govt", label: "State Govt" },
  { value: "Local_Authority", label: "Local Authority" },
  { value: "Trademark_Registry", label: "Trademark Registry" },
  { value: "FIU_IND", label: "FIU-IND" },
  { value: "Other", label: "Other" },
];

const STATUSES = [
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "discontinued", label: "Discontinued" },
];

type Doc = { label: string; url: string; uploadedAt?: string };

type FormValues = {
  id?: string;
  name: string;
  category: string;
  providers: string[];
  regulator: string;
  linkedRegistrationIds: string[];
  requiredExams: string[];
  teamMemberIds: string[];
  status: string;
  launchedAt: string | null;
  discontinuedAt: string | null;
  documents: Doc[];
  remarks: string | null;
};

const EMPTY: FormValues = {
  name: "",
  category: "other",
  providers: [],
  regulator: "Other",
  linkedRegistrationIds: [],
  requiredExams: [],
  teamMemberIds: [],
  status: "active",
  launchedAt: null,
  discontinuedAt: null,
  documents: [],
  remarks: null,
};

export function ProductOfferingForm({
  mode,
  initial,
  teamCatalog,
  registrationCatalog,
}: {
  mode: "create" | "edit";
  initial?: Partial<FormValues> & { id?: string };
  teamCatalog: Array<{ id: string; name: string; roles: string[] }>;
  registrationCatalog: Array<{
    id: string;
    registrationFor: string;
    authority: string;
  }>;
}) {
  const router = useRouter();
  const [v, setV] = useState<FormValues>({ ...EMPTY, ...(initial ?? {}) });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const [newProvider, setNewProvider] = useState("");
  const [newExam, setNewExam] = useState("");
  const [newDoc, setNewDoc] = useState({ label: "", url: "" });

  function field<K extends keyof FormValues>(k: K, val: FormValues[K]) {
    setV((p) => ({ ...p, [k]: val }));
    setOk(null);
  }

  function toggleId(k: "linkedRegistrationIds" | "teamMemberIds", id: string) {
    const cur = v[k];
    setV((p) => ({
      ...p,
      [k]: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id],
    }));
    setOk(null);
  }

  function addChip(arr: keyof FormValues, value: string) {
    const t = value.trim();
    if (!t) return;
    field(arr, [...(v[arr] as string[]), t] as any);
  }
  function removeChip(arr: keyof FormValues, i: number) {
    field(arr, (v[arr] as string[]).filter((_, idx) => idx !== i) as any);
  }

  function addDoc() {
    if (!newDoc.label.trim() || !newDoc.url.trim()) return;
    try {
      new URL(newDoc.url.trim());
    } catch {
      setErr("Document URL is not a valid URL.");
      return;
    }
    field("documents", [
      ...v.documents,
      {
        label: newDoc.label.trim(),
        url: newDoc.url.trim(),
        uploadedAt: new Date().toISOString(),
      },
    ]);
    setNewDoc({ label: "", url: "" });
    setErr(null);
  }
  function removeDoc(i: number) {
    field("documents", v.documents.filter((_, idx) => idx !== i));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setOk(null);
    try {
      const url =
        mode === "create"
          ? "/api/product-offerings"
          : `/api/product-offerings/${initial?.id}`;
      const method = mode === "create" ? "POST" : "PATCH";
      const res = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(v),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? `Failed (${res.status})`);
        return;
      }
      if (mode === "create") {
        router.push(`/dashboard/product-offerings/${j.offering.id}`);
        return;
      }
      setOk("Saved.");
      router.refresh();
    } catch (e: any) {
      setErr(e?.message ?? "Network error");
    } finally {
      setBusy(false);
    }
  }

  async function discontinue() {
    if (!initial?.id) return;
    if (!confirm("Mark this offering as discontinued? It will stay in the catalog for audit but no longer be active.")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/product-offerings/${initial.id}`, {
        method: "DELETE",
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? "Failed");
        return;
      }
      router.push("/dashboard/product-offerings?status=discontinued");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card-surface p-5 space-y-5">
      {err && (
        <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
          {err}
        </div>
      )}
      {ok && (
        <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">
          ✓ {ok}
        </div>
      )}

      {/* Identity */}
      <Grid>
        <Field label="Name *">
          <input
            required
            value={v.name}
            onChange={(e) => field("name", e.target.value)}
            className="input-base text-sm w-full"
            placeholder="e.g. Mutual Fund Distribution"
          />
        </Field>
        <Field label="Category *">
          <SelectField
            value={v.category}
            onChange={(e) => field("category", e.target.value)}
            className="text-sm w-full"
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </SelectField>
        </Field>
        <Field label="Regulator *">
          <SelectField
            value={v.regulator}
            onChange={(e) => field("regulator", e.target.value)}
            className="text-sm w-full"
          >
            {REGULATORS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </SelectField>
        </Field>
        <Field label="Status">
          <SelectField
            value={v.status}
            onChange={(e) => field("status", e.target.value)}
            className="text-sm w-full"
          >
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </SelectField>
        </Field>
        <Field label="Launched on">
          <DateField
            value={v.launchedAt ?? ""}
            onChange={(e) => field("launchedAt", e.target.value || null)}
            className="text-sm w-full"
          />
        </Field>
        {v.status === "discontinued" && (
          <Field label="Discontinued on">
            <DateField
              value={v.discontinuedAt ?? ""}
              onChange={(e) => field("discontinuedAt", e.target.value || null)}
              className="text-sm w-full"
            />
          </Field>
        )}
      </Grid>

      {/* Providers */}
      <Section title="Providers / manufacturers">
        <ChipInput
          chips={v.providers}
          onAdd={(v) => addChip("providers", v)}
          onRemove={(i) => removeChip("providers", i)}
          input={newProvider}
          setInput={setNewProvider}
          placeholder="e.g. HDFC AMC, ICICI Pru, Bajaj Allianz…"
        />
      </Section>

      {/* Licenses */}
      <Section title="Authorising licenses">
        {registrationCatalog.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No active registrations on file yet. Add one at{" "}
            <a
              href="/dashboard/legal-registrations/new"
              className="underline hover:text-foreground"
            >
              Legal registrations
            </a>{" "}
            first.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {registrationCatalog.map((reg) => {
              const on = v.linkedRegistrationIds.includes(reg.id);
              return (
                <button
                  key={reg.id}
                  type="button"
                  onClick={() => toggleId("linkedRegistrationIds", reg.id)}
                  className={`chip text-xs ${
                    on
                      ? "bg-violet-100 text-violet-800 border border-violet-300"
                      : "bg-slate-100 hover:bg-slate-200"
                  }`}
                >
                  {reg.registrationFor}
                  <span className="ml-1 text-[9px] opacity-60">
                    {reg.authority}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </Section>

      {/* Required exams */}
      <Section title="Required exams / certifications">
        <ChipInput
          chips={v.requiredExams}
          onAdd={(v) => addChip("requiredExams", v)}
          onRemove={(i) => removeChip("requiredExams", i)}
          input={newExam}
          setInput={setNewExam}
          placeholder="e.g. NISM-VA, IRDA Specified Persons, NISM-XII…"
        />
      </Section>

      {/* Team */}
      <Section title="Team members trained on this">
        {teamCatalog.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No active employees. Add one at{" "}
            <a
              href="/dashboard/employees"
              className="underline hover:text-foreground"
            >
              Employees
            </a>
            .
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {teamCatalog.map((t) => {
              const on = v.teamMemberIds.includes(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => toggleId("teamMemberIds", t.id)}
                  className={`chip text-xs ${
                    on
                      ? "bg-cyan-100 text-cyan-800 border border-cyan-300"
                      : "bg-slate-100 hover:bg-slate-200"
                  }`}
                >
                  {t.name}
                  {t.roles[0] && (
                    <span className="ml-1 text-[9px] opacity-60">
                      {t.roles[0]}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </Section>

      {/* Documents */}
      <Section title="Documents (brochures, sample contracts, mandates)">
        {v.documents.length > 0 ? (
          <ul className="space-y-1.5 mb-2">
            {v.documents.map((d, i) => (
              <li
                key={i}
                className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-md px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{d.label}</div>
                  <a
                    href={d.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] text-slate-500 truncate inline-flex items-center gap-1 hover:text-slate-800"
                  >
                    {d.url} <ExternalLink className="size-2.5" />
                  </a>
                </div>
                <button
                  type="button"
                  onClick={() => removeDoc(i)}
                  className="text-slate-400 hover:text-rose-600"
                >
                  <X className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground mb-2">
            Paste document URLs (Google Drive, S3, etc.).
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={newDoc.label}
            onChange={(e) =>
              setNewDoc((d) => ({ ...d, label: e.target.value }))
            }
            placeholder="Document label"
            className="input-base text-sm flex-1 min-w-[12rem]"
          />
          <input
            value={newDoc.url}
            onChange={(e) => setNewDoc((d) => ({ ...d, url: e.target.value }))}
            placeholder="https://…"
            className="input-base text-sm flex-1 min-w-[12rem]"
          />
          <button
            type="button"
            onClick={addDoc}
            disabled={!newDoc.label.trim() || !newDoc.url.trim()}
            className="btn-ghost text-xs"
          >
            <Plus className="size-3.5" /> Add
          </button>
        </div>
      </Section>

      {/* Remarks */}
      <Section title="Remarks">
        <textarea
          rows={3}
          value={v.remarks ?? ""}
          onChange={(e) => field("remarks", e.target.value || null)}
          className="input-base text-sm w-full"
          placeholder="Anything else — eligibility constraints, target segments, internal SOPs…"
        />
      </Section>

      <div className="flex flex-wrap items-center justify-between gap-2 pt-4 border-t">
        {mode === "edit" && v.status !== "discontinued" ? (
          <button
            type="button"
            onClick={discontinue}
            disabled={busy}
            className="btn-ghost text-xs text-rose-600 hover:bg-rose-50"
          >
            <Trash2 className="size-3.5" /> Discontinue
          </button>
        ) : (
          <span />
        )}
        <button type="submit" disabled={busy} className="btn-primary text-sm">
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Save className="size-4" />
          )}
          {mode === "create" ? "Add offering" : "Save changes"}
        </button>
      </div>
    </form>
  );
}

function ChipInput({
  chips,
  onAdd,
  onRemove,
  input,
  setInput,
  placeholder,
}: {
  chips: string[];
  onAdd: (v: string) => void;
  onRemove: (i: number) => void;
  input: string;
  setInput: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div>
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {chips.map((c, i) => (
            <span
              key={i}
              className="chip bg-slate-100 text-slate-700 text-xs inline-flex items-center gap-1"
            >
              {c}
              <button
                type="button"
                onClick={() => onRemove(i)}
                className="text-slate-400 hover:text-rose-600"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onAdd(input);
              setInput("");
            }
            if (e.key === "," && input.trim()) {
              e.preventDefault();
              onAdd(input);
              setInput("");
            }
          }}
          placeholder={placeholder}
          className="input-base text-sm flex-1"
        />
        <button
          type="button"
          onClick={() => {
            onAdd(input);
            setInput("");
          }}
          disabled={!input.trim()}
          className="btn-ghost text-xs"
        >
          <Plus className="size-3.5" /> Add
        </button>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
        {title}
      </h3>
      {children}
    </div>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{children}</div>;
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium block mb-1">
        {label}
      </span>
      {children}
    </label>
  );
}
