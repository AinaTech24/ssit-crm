"use client";

/**
 * CustomChartBuilder — the Zoho-style "Add Component" modal. Pick a module, a
 * chart type, a measure (count / sum / avg … of a field), a group-by dimension
 * and an optional date grain; a live preview renders via the same custom-chart
 * API the saved widget uses. "Add to dashboard" returns the declarative config
 * to the board builder, which stores it as a custom_chart widget.
 *
 * Field metadata comes straight from the (client-safe) filter catalog, so any
 * field added to the catalog shows up here automatically.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, BarChart3, LineChart, AreaChart, PieChart, Circle, Filter as FunnelIcon, Hash, Table2, Plus } from "lucide-react";
import { CATALOGS } from "@/lib/filter/catalog";
import { FilterBuilder } from "@/components/filter/FilterBuilder";
import { WidgetView } from "./WidgetView";

const EMPTY_AST = { type: "group", op: "AND", children: [] } as any;

const SUBJECTS = [
  { subject: "lead", label: "Leads" },
  { subject: "investor", label: "Clients" },
  { subject: "business_entry", label: "Business Entries" },
  { subject: "transaction", label: "Transactions" },
  { subject: "review_meeting", label: "Meetings" },
  { subject: "task", label: "Tasks" },
  { subject: "sip", label: "SIPs" },
  { subject: "insurance", label: "Insurance" },
  { subject: "goal", label: "Goals" },
  { subject: "service_request", label: "Service Requests" },
  { subject: "claim", label: "Claims" },
  { subject: "user", label: "Team" },
].filter((s) => (CATALOGS as any)[s.subject]);

const NUMERIC = new Set(["integer", "number", "currency"]);
const DATE = new Set(["date", "datetime"]);
const isDim = (f: any) => ["enum", "string", "uuid", "boolean", "integer", "date", "datetime"].includes(f.type);

const CHART_TYPES: Array<{ key: string; label: string; icon: any; grouped: boolean }> = [
  { key: "kpi", label: "KPI", icon: Hash, grouped: false },
  { key: "column", label: "Column", icon: BarChart3, grouped: true },
  { key: "bar", label: "Bar", icon: BarChart3, grouped: true },
  { key: "line", label: "Line", icon: LineChart, grouped: true },
  { key: "area", label: "Area", icon: AreaChart, grouped: true },
  { key: "pie", label: "Pie", icon: PieChart, grouped: true },
  { key: "donut", label: "Donut", icon: Circle, grouped: true },
  { key: "funnel", label: "Funnel", icon: FunnelIcon, grouped: true },
  { key: "table", label: "Table", icon: Table2, grouped: true },
];

const AGGS: Array<{ key: string; label: string; needsField: boolean; numericOnly: boolean }> = [
  { key: "count", label: "Count of records", needsField: false, numericOnly: false },
  { key: "count_unique", label: "Count unique", needsField: true, numericOnly: false },
  { key: "sum", label: "Sum of", needsField: true, numericOnly: true },
  { key: "avg", label: "Average of", needsField: true, numericOnly: true },
  { key: "min", label: "Minimum of", needsField: true, numericOnly: true },
  { key: "max", label: "Maximum of", needsField: true, numericOnly: true },
];

function fieldsFor(subject: string) {
  const cat = (CATALOGS as any)[subject];
  if (!cat) return { dims: [], measures: [], all: [] };
  return {
    dims: cat.fields.filter(isDim),
    measures: cat.fields.filter((f: any) => NUMERIC.has(f.type)),
    all: cat.fields,
  };
}

export function CustomChartBuilder({
  onClose,
  onAdd,
  initial,
}: {
  onClose: () => void;
  onAdd: (config: any) => void;
  initial?: any;
}) {
  const [subject, setSubject] = useState<string>(initial?.subject ?? "lead");
  const [chartType, setChartType] = useState<string>(initial?.chartType ?? "column");
  const [agg, setAgg] = useState<string>(initial?.agg ?? "count");
  const [field, setField] = useState<string>(initial?.field ?? "");
  const [groupBy, setGroupBy] = useState<string>(initial?.groupBy ?? "");
  const [dateGrain, setDateGrain] = useState<string>(initial?.dateGrain ?? "month");
  const [title, setTitle] = useState<string>(initial?.title ?? "");
  const [ast, setAst] = useState<any>(initial?.ast ?? EMPTY_AST);

  const cat = fieldsFor(subject);
  const aggDef = AGGS.find((a) => a.key === agg)!;
  const chartDef = CHART_TYPES.find((c) => c.key === chartType)!;
  const needsField = aggDef.needsField;
  const needsGroup = chartDef.grouped;
  const measureChoices = aggDef.numericOnly ? cat.measures : cat.all;
  const groupField = cat.dims.find((d: any) => d.key === groupBy);
  const isDateGroup = !!groupField && DATE.has(groupField.type);

  // When the module changes, reset field + group-by to that module's defaults,
  // and clear the criteria (its fields belong to the previous module).
  const firstRun = useRef(true);
  useEffect(() => {
    const f = fieldsFor(subject);
    setGroupBy((g) => (f.dims.some((d: any) => d.key === g) ? g : f.dims[0]?.key ?? ""));
    setField((x) => (f.all.some((d: any) => d.key === x) ? x : (f.measures[0]?.key ?? f.all[0]?.key ?? "")));
    if (firstRun.current) firstRun.current = false;
    else setAst(EMPTY_AST);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject]);

  const valid = (!needsField || !!field) && (!needsGroup || !!groupBy);
  const hasCriteria = !!ast && Array.isArray(ast.children) && ast.children.length > 0;

  const config = useMemo(
    () => ({
      subject,
      chartType,
      agg,
      field: needsField ? field : undefined,
      groupBy: needsGroup ? groupBy : undefined,
      dateGrain: needsGroup && isDateGroup ? dateGrain : undefined,
      ast: hasCriteria ? ast : undefined,
      title: title || undefined,
    }),
    [subject, chartType, agg, field, groupBy, dateGrain, title, needsField, needsGroup, isDateGroup, ast, hasCriteria]
  );

  const body = (
    <div className="fixed inset-0 z-[120] bg-black/40 grid place-items-center p-4" onClick={onClose}>
      <div className="bg-card rounded-xl shadow-xl border border-border/60 w-full max-w-4xl max-h-[88vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="border-b px-5 py-3 flex items-center justify-between">
          <h2 className="font-semibold flex items-center gap-2"><BarChart3 className="size-4 text-brand-cyan" /> Add a component</h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-secondary text-muted-foreground"><X className="size-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 grid md:grid-cols-2 gap-5 scrollbar-thin">
          {/* ── Config ── */}
          <div className="space-y-4">
            <Row label="Module">
              <select value={subject} onChange={(e) => setSubject(e.target.value)} className="input-base">
                {SUBJECTS.map((s) => <option key={s.subject} value={s.subject}>{s.label}</option>)}
              </select>
            </Row>

            <Row label="Chart type">
              <div className="grid grid-cols-3 gap-1.5">
                {CHART_TYPES.map((c) => {
                  const Icon = c.icon;
                  return (
                    <button
                      key={c.key}
                      type="button"
                      onClick={() => setChartType(c.key)}
                      className={`flex flex-col items-center gap-1 rounded-lg border py-2 text-[11px] font-medium transition ${chartType === c.key ? "border-brand-cyan ring-1 ring-brand-cyan bg-brand-cyan-light/40 text-brand-cyan-deep" : "border-border hover:bg-secondary"}`}
                    >
                      <Icon className="size-4" /> {c.label}
                    </button>
                  );
                })}
              </div>
            </Row>

            <Row label="Measure (Y-axis)">
              <div className="flex gap-2">
                <select value={agg} onChange={(e) => setAgg(e.target.value)} className="input-base flex-1">
                  {AGGS.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
                </select>
                {needsField && (
                  <select value={field} onChange={(e) => setField(e.target.value)} className="input-base flex-1">
                    <option value="">— field —</option>
                    {measureChoices.map((f: any) => <option key={f.key} value={f.key}>{f.label}</option>)}
                  </select>
                )}
              </div>
            </Row>

            {needsGroup && (
              <Row label="Group by (X-axis)">
                <div className="flex gap-2">
                  <select value={groupBy} onChange={(e) => setGroupBy(e.target.value)} className="input-base flex-1">
                    <option value="">— dimension —</option>
                    {cat.dims.map((f: any) => <option key={f.key} value={f.key}>{f.label}</option>)}
                  </select>
                  {isDateGroup && (
                    <select value={dateGrain} onChange={(e) => setDateGrain(e.target.value)} className="input-base w-32">
                      {["day", "week", "month", "quarter", "year"].map((g) => <option key={g} value={g}>by {g}</option>)}
                    </select>
                  )}
                </div>
              </Row>
            )}

            <Row label="Title">
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Leads by stage" className="input-base" />
            </Row>

            <div>
              <div className="flex items-center justify-between mb-1">
                <div className="text-xs font-semibold text-muted-foreground">
                  Criteria <span className="font-normal">(optional)</span>
                </div>
                {hasCriteria && (
                  <button
                    type="button"
                    onClick={() => setAst(EMPTY_AST)}
                    className="text-[11px] text-muted-foreground hover:text-foreground underline"
                  >
                    Clear
                  </button>
                )}
              </div>
              <div className="rounded-lg border border-border bg-secondary/20 p-2">
                <FilterBuilder subject={subject} value={ast} onChange={setAst} />
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                Limit this component to records that match — e.g. only “Status is Won”, or “AUM ≥ 10,00,000”.
              </p>
            </div>
          </div>

          {/* ── Live preview ── */}
          <div className="space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Live preview</div>
            <div className="border rounded-lg bg-card p-3 h-72">
              {valid ? (
                <WidgetView widgetKey="custom_chart" config={config} titleOverride={title || "Preview"} />
              ) : (
                <div className="h-full grid place-items-center text-xs text-muted-foreground text-center px-4">
                  {needsField && !field ? "Pick a field for the measure." : "Pick a group-by dimension."}
                </div>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">Preview uses your live data, scoped to this firm.</p>
          </div>
        </div>

        <div className="border-t px-5 py-3 flex justify-end gap-2">
          <button onClick={onClose} className="btn-secondary text-sm">Cancel</button>
          <button onClick={() => onAdd(config)} disabled={!valid} className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-50">
            <Plus className="size-4" /> Add to dashboard
          </button>
        </div>
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(body, document.body) : null;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-xs font-semibold text-muted-foreground mb-1">{label}</div>
      {children}
    </label>
  );
}
