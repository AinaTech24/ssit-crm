"use client";

/**
 * EFFORTS Plan-vs-Actual board (Finowise). Editable Plan + Actual per activity
 * metric; auto metrics (New Leads, FBPs) can pull their actual from the CRM.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Save, Printer, RefreshCw } from "lucide-react";
import { SelectField } from "@/components/ui/SelectField";
import { useToast } from "@/components/ui/Toast";
import type { EffortsStatus } from "@/lib/finance/efforts";

function defaultPeriod(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function recentMonths(count = 24) {
  const out: { value: string; label: string }[] = [];
  const d = new Date();
  d.setDate(1);
  for (let i = 0; i < count; i++) {
    out.push({ value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label: d.toLocaleString("en-IN", { month: "long", year: "numeric" }) });
    d.setMonth(d.getMonth() - 1);
  }
  return out;
}

type Edit = { planned: string; actual: string };

export function EffortsBoard() {
  const toast = useToast();
  const months = useMemo(() => recentMonths(), []);
  const [period, setPeriod] = useState(defaultPeriod());
  const [data, setData] = useState<EffortsStatus | null>(null);
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const hydrate = useCallback((d: EffortsStatus) => {
    setData(d);
    const e: Record<string, Edit> = {};
    for (const r of d.rows) e[r.key] = { planned: r.planned ? String(r.planned) : "", actual: r.actual ? String(r.actual) : "" };
    setEdits(e);
  }, []);

  const load = useCallback(
    async (p: string) => {
      setLoading(true);
      try {
        const res = await fetch(`/api/reports/efforts?period=${p}`, { cache: "no-store" });
        if (!res.ok) throw new Error();
        hydrate(await res.json());
      } catch {
        toast.error("Could not load efforts.", "Load failed");
      } finally {
        setLoading(false);
      }
    },
    [hydrate, toast]
  );

  useEffect(() => {
    load(period);
  }, [period, load]);

  const num = (s: string) => {
    const x = parseFloat(s);
    return Number.isFinite(x) ? x : 0;
  };

  const pullActuals = () => {
    if (!data) return;
    setEdits((prev) => {
      const next = { ...prev };
      for (const r of data.rows) if (r.auto && r.computed != null) next[r.key] = { ...next[r.key], actual: String(r.computed) };
      return next;
    });
    toast.info("Pulled actuals for auto metrics. Review, then Save.", "Pulled from CRM");
  };

  const save = async () => {
    if (!data) return;
    setSaving(true);
    try {
      const entries = data.rows.map((r) => ({ metricKey: r.key, planned: num(edits[r.key]?.planned ?? ""), actual: num(edits[r.key]?.actual ?? "") }));
      const res = await fetch("/api/reports/efforts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ period, entries }),
      });
      if (!res.ok) throw new Error();
      hydrate(await res.json());
      toast.success("Efforts saved.", "Saved");
    } catch {
      toast.error("Could not save.", "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <label className="text-sm">
          <span className="block text-muted-foreground mb-1">Month</span>
          <SelectField className="w-44" value={period} onChange={(e) => setPeriod(e.target.value)}>
            {months.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </SelectField>
        </label>
        <div className="flex-1" />
        <button type="button" onClick={pullActuals} className="btn-secondary" disabled={loading}>
          <RefreshCw className="size-4" /> Pull actuals
        </button>
        <button type="button" onClick={() => window.print()} className="btn-secondary">
          <Printer className="size-4" /> Print
        </button>
        <button type="button" onClick={save} className="btn-primary" disabled={saving || loading}>
          <Save className="size-4" /> {saving ? "Saving…" : "Save"}
        </button>
      </div>

      {loading || !data ? (
        <div className="text-sm text-muted-foreground py-10 text-center">Loading…</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border max-w-2xl">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-brand-cyan-light/40 text-left">
                <th className="px-3 py-2 font-semibold text-xs uppercase tracking-wide">Efforts</th>
                <th className="px-3 py-2 font-semibold text-xs uppercase tracking-wide text-right">Plan</th>
                <th className="px-3 py-2 font-semibold text-xs uppercase tracking-wide text-right">Actual</th>
                <th className="px-3 py-2 font-semibold text-xs uppercase tracking-wide text-right">%</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => {
                const plan = num(edits[r.key]?.planned ?? "");
                const act = num(edits[r.key]?.actual ?? "");
                const pct = plan > 0 ? (act / plan) * 100 : null;
                return (
                  <tr key={r.key} className="border-t border-border">
                    <td className="px-3 py-1.5">
                      {r.label}
                      {r.auto && <span className="text-[11px] text-muted-foreground ml-1">(auto)</span>}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <input type="number" min="0" value={edits[r.key]?.planned ?? ""} onChange={(e) => setEdits((s) => ({ ...s, [r.key]: { ...s[r.key], planned: e.target.value } }))}
                        className="w-24 text-right tabular-nums bg-transparent border-b border-dashed border-border focus:outline-none focus:border-brand-cyan px-0.5 py-0.5 print:border-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" placeholder="0" />
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <input type="number" min="0" value={edits[r.key]?.actual ?? ""} onChange={(e) => setEdits((s) => ({ ...s, [r.key]: { ...s[r.key], actual: e.target.value } }))}
                        className="w-24 text-right tabular-nums bg-transparent border-b border-dashed border-border focus:outline-none focus:border-brand-cyan px-0.5 py-0.5 print:border-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" placeholder="0" />
                    </td>
                    <td className={`px-3 py-1.5 text-right tabular-nums font-medium ${pct != null && pct >= 100 ? "text-emerald-600" : pct != null && pct >= 50 ? "text-amber-600" : "text-rose-600"}`}>
                      {pct != null ? `${pct.toFixed(0)}%` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-muted-foreground print:hidden">
        Set the monthly Plan and record Actuals. “Auto” metrics (New Leads, FBPs) can be pulled from the CRM;
        the rest are entered manually. EFFORTS × EFFECTIVENESS = RESULT.
      </p>
    </div>
  );
}
