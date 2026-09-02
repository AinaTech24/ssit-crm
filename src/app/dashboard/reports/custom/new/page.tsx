"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, BarChart3, Loader2, Save, Table2, Grid3x3, Rows3, Plus, X, ArrowUp, ArrowDown } from "lucide-react";
import { CATALOGS } from "@/lib/filter/catalog";
import { FilterBuilder } from "@/components/filter/FilterBuilder";
import { SelectField } from "@/components/ui/SelectField";

const SUBJECTS: [string, string][] = [
  ["investor", "Clients"],
  ["lead", "Leads"],
  ["task", "Tasks"],
  ["user", "Users / Team"],
  ["transaction", "MF Transactions"],
  ["sip", "SIPs"],
  ["insurance", "Insurance Policies"],
  ["goal", "Goals"],
  ["service_request", "Service Requests"],
  ["claim", "Insurance Claims"],
];
type Group = { type: "group"; op: "AND" | "OR"; not?: boolean; children: any[] };
type Agg = { fn: "count" | "sum" | "avg" | "min" | "max"; field: string };
type ReportType = "detailed" | "summary" | "matrix";
const emptyGroup = (): Group => ({ type: "group", op: "AND", children: [] });
const NUMERIC_TYPES = new Set(["number", "integer", "currency"]);
const AGG_OPTS: [Agg["fn"], string][] = [
  ["count", "Count of records"],
  ["sum", "Sum"],
  ["avg", "Average"],
  ["min", "Minimum"],
  ["max", "Maximum"],
];

export default function NewReportPage() {
  return (
    <Suspense fallback={<div className="grid place-items-center min-h-[300px]"><Loader2 className="size-6 animate-spin text-brand-cyan" /></div>}>
      <Builder />
    </Suspense>
  );
}

function Builder() {
  const router = useRouter();
  const editId = useSearchParams().get("edit");

  const [form, setForm] = useState({ name: "", description: "", subject: "investor", reportType: "detailed" as ReportType, sharedScope: "private", chartType: "none", folder: "" });
  const [ast, setAst] = useState<Group>(emptyGroup());
  const [columns, setColumns] = useState<string[]>([]);
  const [sort, setSort] = useState<{ field: string; dir: "asc" | "desc" } | null>(null);
  const [matrix, setMatrix] = useState<{ groupBy: string; pivot: string; aggregate: Agg["fn"]; measure: string }>({ groupBy: "", pivot: "", aggregate: "count", measure: "" });
  const [summary, setSummary] = useState<{ groupBy: string[]; columns: string[]; aggregates: Agg[]; showDetailRows: boolean }>({ groupBy: [""], columns: [], aggregates: [{ fn: "count", field: "" }], showDetailRows: true });
  const [schedule, setSchedule] = useState({ enabled: false, freq: "weekly", hour: 9, day: 1, emails: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const cat = CATALOGS[form.subject] ?? CATALOGS.investor;
  const numericFields = useMemo(() => cat.fields.filter((f) => NUMERIC_TYPES.has(f.type)), [cat]);
  const fieldLabel = (key: string) => cat.fields.find((f) => f.key === key)?.label ?? key;

  // Default config when subject changes (and nothing chosen yet).
  useEffect(() => {
    if (!editId) {
      setColumns(cat.fields.slice(0, 5).map((f) => f.key));
      setMatrix((m) => ({ ...m, groupBy: cat.fields[0]?.key ?? "", pivot: "", measure: "" }));
      setSummary({ groupBy: [cat.fields[0]?.key ?? ""], columns: cat.fields.slice(0, 4).map((f) => f.key), aggregates: [{ fn: "count", field: "" }], showDetailRows: true });
      setSort(null);
      setAst(emptyGroup());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.subject]);

  // Load on edit
  useEffect(() => {
    if (!editId) return;
    (async () => {
      const r = await fetch(`/api/reports/saved/${editId}`);
      if (!r.ok) return;
      const d = await r.json();
      setForm({ name: d.name ?? "", description: d.description ?? "", subject: d.subject, reportType: d.reportType, sharedScope: d.sharedScope ?? "private", chartType: d.chartType ?? "none", folder: d.folder ?? "" });
      setAst(d.ast ?? emptyGroup());
      setColumns(d.columns ?? []);
      setSort(d.sort ?? null);
      if (d.matrix) setMatrix({ groupBy: d.matrix.groupBy ?? "", pivot: d.matrix.pivot ?? "", aggregate: d.matrix.aggregate ?? "count", measure: d.matrix.measure ?? "" });
      if (d.summary) setSummary({ groupBy: d.summary.groupBy?.length ? d.summary.groupBy : [""], columns: d.summary.columns ?? [], aggregates: d.summary.aggregates?.length ? d.summary.aggregates.map((a: any) => ({ fn: a.fn, field: a.field ?? "" })) : [{ fn: "count", field: "" }], showDetailRows: d.summary.showDetailRows ?? true });
      if (d.schedule) setSchedule({ enabled: !!d.schedule.enabled, freq: d.schedule.freq ?? "weekly", hour: d.schedule.hour ?? 9, day: d.schedule.day ?? 1, emails: (d.schedule.emails ?? []).join(", ") });
    })();
  }, [editId]);

  async function save() {
    setErr(null);
    if (!form.name.trim()) return setErr("Give your report a name.");
    if (form.reportType === "detailed" && columns.length === 0) return setErr("Pick at least one column.");
    if (form.reportType === "matrix" && !matrix.groupBy) return setErr("Pick a 'group by' field.");
    if (form.reportType === "matrix" && matrix.aggregate !== "count" && !matrix.measure) return setErr("Pick a field to aggregate.");
    if (form.reportType === "summary") {
      const gb = summary.groupBy.filter(Boolean);
      if (gb.length === 0) return setErr("Pick at least one 'group by' field.");
      if (summary.aggregates.some((a) => a.fn !== "count" && !a.field)) return setErr("Each non-count summary needs a field.");
    }
    setBusy(true);
    try {
      const payload: any = {
        name: form.name,
        description: form.description || undefined,
        subject: form.subject,
        reportType: form.reportType,
        sharedScope: form.sharedScope,
        folder: form.folder.trim() || null,
        chartType: form.reportType === "matrix" ? form.chartType : "none",
        ast,
        columns: form.reportType === "detailed" ? columns : undefined,
        sort: form.reportType === "detailed" ? sort : undefined,
        matrix:
          form.reportType === "matrix"
            ? { groupBy: matrix.groupBy, pivot: matrix.pivot || undefined, aggregate: matrix.aggregate, measure: matrix.aggregate !== "count" ? matrix.measure : undefined }
            : undefined,
        summary:
          form.reportType === "summary"
            ? {
              groupBy: summary.groupBy.filter(Boolean),
              columns: summary.columns,
              aggregates: summary.aggregates.map((a) => ({ fn: a.fn, field: a.fn === "count" ? undefined : a.field })),
              showDetailRows: summary.showDetailRows,
            }
            : undefined,
        schedule:
          schedule.enabled && schedule.emails.trim()
            ? {
              freq: schedule.freq,
              hour: Number(schedule.hour),
              day: schedule.freq === "daily" ? undefined : Number(schedule.day),
              emails: schedule.emails.split(",").map((s) => s.trim()).filter(Boolean),
              enabled: true,
            }
            : null,
      };
      const res = await fetch(editId ? `/api/reports/saved/${editId}` : "/api/reports/saved", {
        method: editId ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? "Save failed");
        return;
      }
      router.push(`/dashboard/reports/custom/${editId ?? j.id}`);
    } catch (e: any) {
      setErr(e.message ?? "Save failed");
    } finally {
      setBusy(false);
    }
  }

  const LAYOUTS: [ReportType, string, React.ReactNode][] = [
    ["detailed", "Detailed", <Table2 key="d" className="size-3.5" />],
    ["summary", "Summary", <Rows3 key="s" className="size-3.5" />],
    ["matrix", "Matrix", <Grid3x3 key="m" className="size-3.5" />],
  ];

  return (
    <div className="space-y-4 max-w-4xl">
      <Link href="/dashboard/reports/custom" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
        <ChevronLeft className="size-4" /> Back to custom reports
      </Link>
      <div>
        <h1 className="page-title">
          <BarChart3 className="size-6 text-brand-cyan" /> {editId ? "Edit report" : "New report"}
        </h1>
      </div>

      {/* 1. Details */}
      <Section title="1. Report details">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Name *"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. HNI clients with no review in 90 days" className="input-base" /></Field>
          <Field label="Module">
            <SelectField value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} className="w-full">
              {SUBJECTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </SelectField>
          </Field>
        </div>
        <Field label="Description"><input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Optional — what this report shows" className="input-base" /></Field>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Layout">
            <div className="inline-flex rounded-lg border border-border bg-card p-0.5 w-full">
              {LAYOUTS.map(([t, lbl, icon]) => (
                <button key={t} type="button" onClick={() => setForm({ ...form, reportType: t })} className={`flex-1 inline-flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-sm font-medium transition-colors ${form.reportType === t ? "bg-brand-navy text-white" : "text-muted-foreground hover:text-foreground"}`}>
                  {icon} {lbl}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Folder">
            <input value={form.folder} onChange={(e) => setForm({ ...form, folder: e.target.value })} placeholder="e.g. Sales, Compliance" className="input-base" list="report-folders" />
          </Field>
          <Field label="Sharing">
            <SelectField value={form.sharedScope} onChange={(e) => setForm({ ...form, sharedScope: e.target.value })} className="w-full">
              <option value="private">Private — only me</option>
              <option value="team">Team — my branch</option>
              <option value="tenant">Everyone in the firm</option>
            </SelectField>
          </Field>
        </div>
      </Section>

      {/* 2. Filter */}
      <Section title="2. Filter rows">
        <FilterBuilder subject={form.subject} value={ast} onChange={setAst} />
      </Section>

      {/* 3. Layout config */}
      {form.reportType === "detailed" && (
        <Section title="3. Columns & sort">
          <ColumnEditor fields={cat.fields} selected={columns} onChange={setColumns} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Sort by">
              <SelectField value={sort?.field ?? ""} onChange={(e) => setSort(e.target.value ? { field: e.target.value, dir: sort?.dir ?? "desc" } : null)} className="w-full">
                <option value="">— none —</option>
                {cat.fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
              </SelectField>
            </Field>
            {sort && (
              <Field label="Direction">
                <SelectField value={sort.dir} onChange={(e) => setSort({ ...sort, dir: e.target.value as "asc" | "desc" })} className="w-full">
                  <option value="desc">High → Low / Newest</option>
                  <option value="asc">Low → High / Oldest</option>
                </SelectField>
              </Field>
            )}
          </div>
        </Section>
      )}

      {form.reportType === "summary" && (
        <Section title="3. Grouping & totals">
          <div>
            <div className="text-xs font-medium mb-1.5">Group rows by (up to 3 levels)</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {[0, 1, 2].map((i) => (
                <SelectField
                  key={i}
                  value={summary.groupBy[i] ?? ""}
                  onChange={(e) => {
                    const gb = [...summary.groupBy];
                    gb[i] = e.target.value;
                    setSummary({ ...summary, groupBy: gb.filter((v, idx) => v || idx === 0).slice(0, 3) });
                  }}
                  className="w-full"
                >
                  <option value="">{i === 0 ? "— pick a field —" : "— none —"}</option>
                  {cat.fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                </SelectField>
              ))}
            </div>
          </div>

          <div>
            <div className="text-xs font-medium mb-1.5">Summarise (aggregate columns)</div>
            <div className="space-y-2">
              {summary.aggregates.map((a, i) => (
                <div key={i} className="flex items-center gap-2">
                  <SelectField
                    value={a.fn}
                    onChange={(e) => {
                      const next = [...summary.aggregates];
                      next[i] = { ...a, fn: e.target.value as Agg["fn"] };
                      setSummary({ ...summary, aggregates: next });
                    }}
                    className="max-w-[180px]"
                  >
                    {AGG_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </SelectField>
                  {a.fn !== "count" && (
                    <SelectField
                      value={a.field}
                      onChange={(e) => {
                        const next = [...summary.aggregates];
                        next[i] = { ...a, field: e.target.value };
                        setSummary({ ...summary, aggregates: next });
                      }}
                      className="flex-1"
                    >
                      <option value="">— pick a number field —</option>
                      {numericFields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                    </SelectField>
                  )}
                  <button type="button" onClick={() => setSummary({ ...summary, aggregates: summary.aggregates.filter((_, idx) => idx !== i) })} className="btn-icon hover:text-rose-600" aria-label="Remove">
                    <X className="size-4" />
                  </button>
                </div>
              ))}
              <button type="button" onClick={() => setSummary({ ...summary, aggregates: [...summary.aggregates, { fn: "sum", field: "" }] })} className="text-xs text-brand-cyan-deep hover:underline inline-flex items-center gap-1">
                <Plus className="size-3.5" /> Add summary column
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">A record count is always shown per group. Sub-totals + grand total are computed automatically.</p>
          </div>

          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={summary.showDetailRows} onChange={(e) => setSummary({ ...summary, showDetailRows: e.target.checked })} />
            Show detail rows under each group
          </label>
          {summary.showDetailRows && (
            <div className="pt-1">
              <div className="text-xs font-medium mb-1.5">Detail-row columns</div>
              <ColumnEditor fields={cat.fields} selected={summary.columns} onChange={(c) => setSummary({ ...summary, columns: c })} />
            </div>
          )}
        </Section>
      )}

      {form.reportType === "matrix" && (
        <Section title="3. Matrix layout">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Group rows by *">
              <SelectField value={matrix.groupBy} onChange={(e) => setMatrix({ ...matrix, groupBy: e.target.value })} className="w-full">
                {cat.fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
              </SelectField>
            </Field>
            <Field label="Pivot columns by (optional)">
              <SelectField value={matrix.pivot} onChange={(e) => setMatrix({ ...matrix, pivot: e.target.value })} className="w-full">
                <option value="">— single column —</option>
                {cat.fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
              </SelectField>
            </Field>
            <Field label="Aggregate">
              <SelectField value={matrix.aggregate} onChange={(e) => setMatrix({ ...matrix, aggregate: e.target.value as Agg["fn"] })} className="w-full">
                {AGG_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </SelectField>
            </Field>
            {matrix.aggregate !== "count" && (
              <Field label="On field *">
                <SelectField value={matrix.measure} onChange={(e) => setMatrix({ ...matrix, measure: e.target.value })} className="w-full">
                  <option value="">— pick a number field —</option>
                  {numericFields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                </SelectField>
              </Field>
            )}
            <Field label="Chart">
              <SelectField value={form.chartType} onChange={(e) => setForm({ ...form, chartType: e.target.value })} className="w-full">
                <option value="none">No chart</option>
                <option value="bar">Bar chart</option>
                <option value="line">Line chart</option>
                <option value="area">Area chart</option>
                <option value="pie">Pie chart</option>
                <option value="donut">Donut chart</option>
              </SelectField>
            </Field>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Example: group by RM, pivot by status, count → an RM × status cross-tab.
          </p>
        </Section>
      )}

      <Section title="4. Email schedule (optional)">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={schedule.enabled} onChange={(e) => setSchedule({ ...schedule, enabled: e.target.checked })} />
          Email this report automatically
        </label>
        {schedule.enabled && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Frequency">
              <SelectField value={schedule.freq} onChange={(e) => setSchedule({ ...schedule, freq: e.target.value })} className="w-full">
                <option value="daily">Every day</option>
                <option value="weekly">Every week</option>
                <option value="monthly">Every month</option>
              </SelectField>
            </Field>
            {schedule.freq === "weekly" && (
              <Field label="Day of week">
                <SelectField value={String(schedule.day)} onChange={(e) => setSchedule({ ...schedule, day: Number(e.target.value) })} className="w-full">
                  {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((d, i) => <option key={i} value={i}>{d}</option>)}
                </SelectField>
              </Field>
            )}
            {schedule.freq === "monthly" && (
              <Field label="Day of month (1–28)">
                <input type="number" min={1} max={28} value={schedule.day} onChange={(e) => setSchedule({ ...schedule, day: Number(e.target.value) })} className="input-base" />
              </Field>
            )}
            <Field label="Hour (0–23)">
              <input type="number" min={0} max={23} value={schedule.hour} onChange={(e) => setSchedule({ ...schedule, hour: Number(e.target.value) })} className="input-base" />
            </Field>
            <div className="col-span-2">
              <Field label="Recipients — comma-separated emails">
                <input value={schedule.emails} onChange={(e) => setSchedule({ ...schedule, emails: e.target.value })} placeholder="rm@firm.com, owner@firm.com" className="input-base" />
              </Field>
            </div>
          </div>
        )}
      </Section>

      {err && <div className="rounded-lg border border-destructive/30 bg-destructive/5 text-destructive text-sm px-3 py-2">{err}</div>}

      <div className="flex justify-end gap-2 pb-8">
        <Link href="/dashboard/reports/custom" className="btn-secondary">Cancel</Link>
        <button type="button" onClick={save} disabled={busy} className="btn-primary">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          {busy ? "Saving…" : editId ? "Update report" : "Save & run"}
        </button>
      </div>
    </div>
  );
}

/**
 * Ordered column picker: an available-fields palette (searchable) on the left,
 * and the chosen columns as an ordered, reorderable list on the right. Matches
 * Zoho's "modify columns" (add / remove / reorder).
 */
function ColumnEditor({ fields, selected, onChange }: { fields: { key: string; label: string }[]; selected: string[]; onChange: (next: string[]) => void }) {
  const [q, setQ] = useState("");
  const labelOf = (k: string) => fields.find((f) => f.key === k)?.label ?? k;
  const available = fields.filter((f) => !selected.includes(f.key) && f.label.toLowerCase().includes(q.toLowerCase()));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= selected.length) return;
    const next = [...selected];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div>
        <div className="relative mb-1.5">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search fields…" className="input-base text-xs py-1.5" />
        </div>
        <div className="rounded-lg border border-border max-h-56 overflow-y-auto divide-y">
          {available.length === 0 ? (
            <div className="p-3 text-xs text-muted-foreground text-center">No more fields.</div>
          ) : (
            available.map((f) => (
              <button key={f.key} type="button" onClick={() => onChange([...selected, f.key])} className="w-full text-left px-3 py-1.5 text-xs hover:bg-secondary/50 flex items-center justify-between">
                {f.label} <Plus className="size-3 text-muted-foreground" />
              </button>
            ))
          )}
        </div>
      </div>
      <div>
        <div className="text-xs font-medium mb-1.5 text-muted-foreground">{selected.length} selected — drag order with arrows</div>
        <div className="rounded-lg border border-border max-h-[15.5rem] overflow-y-auto divide-y">
          {selected.length === 0 ? (
            <div className="p-3 text-xs text-muted-foreground text-center">Pick fields from the left.</div>
          ) : (
            selected.map((k, i) => (
              <div key={k} className="px-2 py-1.5 text-xs flex items-center gap-1.5">
                <span className="flex-1 truncate">{labelOf(k)}</span>
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="btn-icon disabled:opacity-30" aria-label="Up"><ArrowUp className="size-3" /></button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === selected.length - 1} className="btn-icon disabled:opacity-30" aria-label="Down"><ArrowDown className="size-3" /></button>
                <button type="button" onClick={() => onChange(selected.filter((x) => x !== k))} className="btn-icon hover:text-rose-600" aria-label="Remove"><X className="size-3" /></button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card-surface p-5 space-y-3">
      <div className="flex items-center gap-2">
        <div className="h-4 w-1 rounded-full brand-bar" />
        <h2 className="section-title">{title}</h2>
      </div>
      {children}
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-xs font-medium mb-1">{label}</div>
      {children}
    </label>
  );
}
