"use client";

/**
 * Renders ONE dashboard widget: fetches its data from
 * /api/dashboard/widgets/[key] and draws it by view kind (kpi / chart / donut /
 * funnel / table). Used by both the live custom dashboard and the builder
 * preview. Pure presentation — drag/resize/remove chrome is added by the editor.
 */

import { useCallback, useEffect, useState } from "react";
import {
  ResponsiveContainer, AreaChart, Area, LineChart, Line, BarChart, Bar,
  PieChart, Pie, Cell, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import { Loader2, AlertCircle, Download, RefreshCw } from "lucide-react";
import { formatINR, formatDate } from "@/lib/utils";
import { WIDGET_META_BY_KEY } from "@/lib/dashboards/widgets";

const PALETTE = ["#0ea5e9", "#6366f1", "#10b981", "#f59e0b", "#ef4444", "#a855f7", "#14b8a6", "#ec4899"];

/**
 * Module-level in-memory cache keyed by widgetKey+rm+period. Keeps re-renders
 * and remounts (e.g. toggling Present mode, reordering in the builder) from
 * re-hitting the API. Short TTL so a viewed board stays reasonably fresh, with
 * an opt-in periodic refetch on top. No persistence, no deps — cleared on full
 * page reload.
 */
const CACHE_TTL_MS = 60_000;
const REFRESH_MS = 60_000;
type FetchResult = { view?: View; rows: any[]; chart?: string; error?: string };
const widgetCache = new Map<string, { at: number; data: FetchResult }>();

function cacheKey(widgetKey: string, rm: string, period: string, custom?: any): string {
  return custom ? `custom:${JSON.stringify(custom)}` : `${widgetKey}|${rm}|${period}`;
}

type View =
  | { kind: "kpi"; valueKey: string; format: "inr" | "number" | "pct" }
  | { kind: "chart"; x: string; series: { key: string; label: string }[]; format?: "inr" | "number" }
  | { kind: "donut"; labelKey: string; valueKey: string; format?: "inr" | "number" }
  | { kind: "funnel"; labelKey: string; valueKey: string }
  | { kind: "meter"; valueKey: string; targetKey: string; format: "inr" | "number" }
  | { kind: "comparator"; currentKey: string; previousKey: string; format: "inr" | "number" }
  | { kind: "table"; columns: { key: string; label: string; format?: "inr" | "date" | "number" | "pct" }[] };

function downloadCsv(title: string, rows: any[]) {
  if (!rows.length) return;
  const keys = Object.keys(rows[0]).filter((k) => k !== "d");
  const esc = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [keys.join(","), ...rows.map((r) => keys.map((k) => esc(r[k])).join(","))].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${title.replace(/[^\w]+/g, "_")}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function fmt(v: any, format?: string): string {
  if (v === null || v === undefined || v === "") return "—";
  if (format === "inr") return formatINR(Number(v));
  if (format === "date") return formatDate(v);
  if (format === "pct") return `${Number(v).toLocaleString("en-IN")}%`;
  if (format === "number") return Number(v).toLocaleString("en-IN");
  return String(v);
}

export function WidgetView({ widgetKey, rm, period, titleOverride, config }: { widgetKey: string; rm?: string; period?: string; titleOverride?: string; config?: any }) {
  const meta = WIDGET_META_BY_KEY[widgetKey];
  // A custom component carries its own definition (subject + chartType) in config
  // and is rendered by the custom-chart aggregate API instead of a static widget.
  const isCustom = !!(config && config.subject && config.chartType);
  const configJson = JSON.stringify(config);
  const [state, setState] = useState<{ loading: boolean; error?: string; view?: View; rows?: any[]; chart?: string }>({ loading: true });

  // `force` bypasses the cache (Retry button + periodic refresh).
  const load = useCallback((force: boolean) => {
    let alive = true;
    const key = cacheKey(widgetKey, rm ?? "", period ?? "", isCustom ? config : undefined);

    if (!force) {
      const hit = widgetCache.get(key);
      if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
        setState({ loading: false, ...hit.data });
        return () => { alive = false; };
      }
    }

    setState((s) => (s.view ? s : { loading: true }));
    const apply = (j: any, chart?: string) => {
      const data: FetchResult = { view: j.view, rows: j.rows ?? [], error: j.error, chart: chart ?? j.chart };
      widgetCache.set(key, { at: Date.now(), data });
      if (alive) setState({ loading: false, ...data });
    };
    const fail = (e: any) => { if (alive) setState((s) => ({ ...s, loading: false, error: e?.message ?? "Failed to load" })); };

    if (isCustom) {
      fetch(`/api/dashboard/custom-chart`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(config),
      }).then((r) => r.json()).then((j) => apply(j, j.chart)).catch(fail);
    } else {
      const params = new URLSearchParams();
      if (rm) params.set("rm", rm);
      if (period) params.set("period", period);
      const qs = params.toString();
      fetch(`/api/dashboard/widgets/${widgetKey}${qs ? `?${qs}` : ""}`).then((r) => r.json()).then((j) => apply(j, meta?.chart)).catch(fail);
    }
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widgetKey, rm, period, isCustom, configJson]);

  useEffect(() => load(false), [load]);

  // Light auto-refresh: refetch on an interval, paused while the tab is hidden.
  useEffect(() => {
    const tick = () => { if (!document.hidden) load(true); };
    const t = setInterval(tick, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  const title = titleOverride || config?.title || meta?.title || widgetKey;

  return (
    <div className="h-full flex flex-col group/widget">
      <div className="flex items-center justify-between gap-1 px-1 pb-1 shrink-0">
        <span className="text-xs font-semibold text-muted-foreground truncate">{title}</span>
        {!state.loading && (state.rows?.length ?? 0) > 0 && (
          <button
            type="button"
            onClick={() => downloadCsv(title, state.rows ?? [])}
            className="opacity-0 group-hover/widget:opacity-100 transition-opacity text-muted-foreground hover:text-foreground shrink-0"
            title="Download CSV"
          >
            <Download className="size-3.5" />
          </button>
        )}
      </div>
      <div className="flex-1 min-h-0">
        {state.loading ? (
          <div className="h-full grid place-items-center text-muted-foreground"><Loader2 className="size-4 animate-spin" /></div>
        ) : state.error || !state.view ? (
          <div className="h-full grid place-items-center text-center px-2">
            <div className="space-y-1.5">
              <div className="inline-flex items-center gap-1 text-xs text-rose-600"><AlertCircle className="size-3.5" /> {state.error ? "Couldn’t load" : "No data"}</div>
              {state.error && (
                <div>
                  <button
                    type="button"
                    onClick={() => load(true)}
                    className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  >
                    <RefreshCw className="size-3" /> Retry
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : (
          <Body view={state.view} rows={state.rows ?? []} chart={state.chart ?? meta?.chart} />
        )}
      </div>
    </div>
  );
}

function Body({ view, rows, chart }: { view: View; rows: any[]; chart?: string }) {
  if (view.kind === "kpi") {
    const raw = rows[0]?.[view.valueKey];
    return (
      <div className="h-full grid place-items-center">
        <div className="text-3xl font-bold tabular-nums tracking-tight text-center">{fmt(raw, view.format)}</div>
      </div>
    );
  }

  if (view.kind === "chart") {
    const data = rows.map((r) => ({ ...r, ...Object.fromEntries(view.series.map((sv) => [sv.key, Number(r[sv.key] ?? 0)])) }));
    if (!data.length) return <Empty />;
    const axis = <>
      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef2f7" />
      <XAxis dataKey={view.x} tick={{ fontSize: 10 }} interval="preserveStartEnd" />
      <YAxis tick={{ fontSize: 10 }} width={40} tickFormatter={(v) => compact(Number(v))} />
      <Tooltip formatter={(v: any) => fmt(v, view.format)} />
    </>;
    return (
      <ResponsiveContainer width="100%" height="100%">
        {chart === "bar" ? (
          <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            {axis}
            {view.series.map((sv, i) => <Bar key={sv.key} dataKey={sv.key} fill={PALETTE[i % PALETTE.length]} radius={[3, 3, 0, 0]} />)}
          </BarChart>
        ) : chart === "line" ? (
          <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            {axis}
            {view.series.map((sv, i) => <Line key={sv.key} type="monotone" dataKey={sv.key} stroke={PALETTE[i % PALETTE.length]} dot={false} strokeWidth={2} />)}
          </LineChart>
        ) : (
          <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            {axis}
            {view.series.map((sv, i) => <Area key={sv.key} type="monotone" dataKey={sv.key} stroke={PALETTE[i % PALETTE.length]} fill={PALETTE[i % PALETTE.length]} fillOpacity={0.15} strokeWidth={2} />)}
          </AreaChart>
        )}
      </ResponsiveContainer>
    );
  }

  if (view.kind === "donut") {
    const data = rows.map((r) => ({ name: r[view.labelKey], value: Number(r[view.valueKey] ?? 0) })).filter((d) => d.value > 0);
    if (!data.length) return <Empty />;
    return (
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius="45%" outerRadius="80%" paddingAngle={2}>
            {data.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
          </Pie>
          <Tooltip formatter={(v: any, n: any) => [fmt(v, view.format), n]} />
        </PieChart>
      </ResponsiveContainer>
    );
  }

  if (view.kind === "funnel") {
    const data = rows.map((r) => ({ label: r[view.labelKey], value: Number(r[view.valueKey] ?? 0) }));
    const max = Math.max(1, ...data.map((d) => d.value));
    if (!data.length) return <Empty />;
    return (
      <div className="h-full overflow-auto space-y-1 pr-1">
        {data.map((d, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="w-28 shrink-0 text-[11px] text-muted-foreground truncate">{d.label}</div>
            <div className="flex-1 h-4 rounded bg-muted overflow-hidden">
              <div className="h-full rounded bg-brand-cyan/70" style={{ width: `${(d.value / max) * 100}%` }} />
            </div>
            <div className="w-10 shrink-0 text-right text-[11px] font-mono tabular-nums">{d.value}</div>
          </div>
        ))}
      </div>
    );
  }

  if (view.kind === "meter") {
    const value = Number(rows[0]?.[view.valueKey] ?? 0);
    const target = Number(rows[0]?.[view.targetKey] ?? 0);
    const pct = target > 0 ? Math.min(100, (value / target) * 100) : 0;
    const tone = pct >= 100 ? "bg-emerald-500" : pct >= 60 ? "bg-brand-cyan" : "bg-amber-500";
    return (
      <div className="h-full flex flex-col justify-center gap-2 px-1">
        <div className="flex items-end justify-between gap-2">
          <span className="text-2xl font-bold tabular-nums">{fmt(value, view.format)}</span>
          <span className="text-[11px] text-muted-foreground text-right">{target > 0 ? `of ${fmt(target, view.format)} · ${pct.toFixed(0)}%` : "no target set"}</span>
        </div>
        <div className="h-2.5 rounded-full bg-muted overflow-hidden">
          <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
        </div>
      </div>
    );
  }

  if (view.kind === "comparator") {
    const cur = Number(rows[0]?.[view.currentKey] ?? 0);
    const prev = Number(rows[0]?.[view.previousKey] ?? 0);
    const delta = prev !== 0 ? ((cur - prev) / Math.abs(prev)) * 100 : cur > 0 ? 100 : 0;
    const up = cur >= prev;
    return (
      <div className="h-full flex items-center justify-around gap-2 px-1">
        <div className="text-center">
          <div className="text-2xl font-bold tabular-nums">{fmt(cur, view.format)}</div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">This month</div>
        </div>
        <div className={`text-sm font-semibold ${up ? "text-emerald-600" : "text-rose-600"}`}>{up ? "▲" : "▼"} {Math.abs(delta).toFixed(0)}%</div>
        <div className="text-center">
          <div className="text-lg font-semibold tabular-nums text-muted-foreground">{fmt(prev, view.format)}</div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Last month</div>
        </div>
      </div>
    );
  }

  // table
  if (view.kind !== "table") return <Empty />;
  if (!rows.length) return <Empty />;
  return (
    <div className="h-full overflow-auto">
      <table className="w-full text-xs">
        <thead className="text-[10px] uppercase text-muted-foreground sticky top-0 bg-card">
          <tr>{view.columns.map((c) => <th key={c.key} className={`text-left font-medium py-1 pr-2 ${c.format === "inr" || c.format === "number" ? "text-right" : ""}`}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-border/50">
              {view.columns.map((c) => (
                <td key={c.key} className={`py-1 pr-2 truncate max-w-[160px] ${c.format === "inr" || c.format === "number" ? "text-right tabular-nums" : ""}`}>{fmt(r[c.key], c.format)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Empty() {
  return <div className="h-full grid place-items-center text-xs text-muted-foreground">No data yet</div>;
}

function compact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e7) return `${(n / 1e7).toFixed(1)}Cr`;
  if (abs >= 1e5) return `${(n / 1e5).toFixed(1)}L`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(0)}k`;
  return String(n);
}
