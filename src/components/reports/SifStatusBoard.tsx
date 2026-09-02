"use client";

/**
 * SIF Business — FY Target vs Actual % with the Branch → Desk roll-up. Targets
 * are editable on desk rows (and on branches without desks); subtotals, the
 * "(No desk)" residual and the WCFW total are computed live. Actuals come from
 * SIF business booked in the FY.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Save, Printer } from "lucide-react";
import { SelectField } from "@/components/ui/SelectField";
import { useToast } from "@/components/ui/Toast";
import type { SifStatus, SifRow } from "@/lib/business/sif-status";

const fmt = (n: number): string =>
  "₹ " + n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

function recentFYs(count = 5): string[] {
  const d = new Date();
  const startY = d.getMonth() + 1 >= 4 ? d.getFullYear() : d.getFullYear() - 1;
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const y = startY - i + 1; // include next FY first
    out.push(`${y}-${String((y + 1) % 100).padStart(2, "0")}`);
  }
  return out;
}

export function SifStatusBoard() {
  const toast = useToast();
  const fys = useMemo(() => recentFYs(), []);
  const [fy, setFy] = useState<string>(fys[1] ?? fys[0]);
  const [data, setData] = useState<SifStatus | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({}); // scopeId -> target string
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const hydrate = useCallback((d: SifStatus) => {
    setData(d);
    const e: Record<string, string> = {};
    for (const r of d.rows) if (r.editable && r.scopeId) e[r.scopeId] = String(r.target || "");
    setEdits(e);
  }, []);

  const load = useCallback(
    async (f: string) => {
      setLoading(true);
      try {
        const res = await fetch(`/api/reports/sif-status?fy=${f}`, { cache: "no-store" });
        if (!res.ok) throw new Error();
        hydrate(await res.json());
      } catch {
        toast.error("Could not load SIF status.", "Load failed");
      } finally {
        setLoading(false);
      }
    },
    [hydrate, toast]
  );

  useEffect(() => {
    load(fy);
  }, [fy, load]);

  const num = (s: string) => {
    const x = parseFloat(s);
    return Number.isFinite(x) ? x : 0;
  };

  // Live recompute of subtotals/total from current edits.
  const rows = useMemo(() => {
    if (!data) return [];
    const targetOf = (r: SifRow) => (r.editable && r.scopeId ? num(edits[r.scopeId] ?? "") : r.target);
    // First pass: editable + actual stay; recompute branch_total/firm_total targets.
    const out = data.rows.map((r) => ({ ...r, target: targetOf(r) }));
    // branch_total target = sum of preceding desk rows since last total; firm = sum branch-level.
    let deskSum = 0;
    let firmSum = 0;
    for (let i = 0; i < out.length; i++) {
      const r = out[i];
      if (r.kind === "desk") deskSum += r.target;
      else if (r.kind === "branch_total") {
        r.target = deskSum;
        firmSum += deskSum;
        deskSum = 0;
      } else if (r.kind === "branch") {
        firmSum += r.target;
      } else if (r.kind === "firm_total") {
        r.target = firmSum;
      }
    }
    return out;
  }, [data, edits]);

  const save = async () => {
    if (!data) return;
    setSaving(true);
    try {
      const targets = data.rows
        .filter((r) => r.editable && r.scopeId && r.scopeType)
        .map((r) => ({ scopeType: r.scopeType as "branch" | "desk", scopeId: r.scopeId as string, target: num(edits[r.scopeId as string] ?? "") }));
      const res = await fetch("/api/reports/sif-status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fiscalYear: fy, targets }),
      });
      if (!res.ok) throw new Error();
      hydrate(await res.json());
      toast.success("SIF targets saved.", "Saved");
    } catch {
      toast.error("Could not save targets.", "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const pct = (a: number, t: number) => (t > 0 ? (a / t) * 100 : null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <label className="text-sm">
          <span className="block text-muted-foreground mb-1">Financial year</span>
          <SelectField className="w-40" value={fy} onChange={(e) => setFy(e.target.value)}>
            {fys.map((f) => (
              <option key={f} value={f}>
                FY {f}
              </option>
            ))}
          </SelectField>
        </label>
        <div className="flex-1" />
        <button type="button" onClick={() => window.print()} className="btn-secondary">
          <Printer className="size-4" /> Print
        </button>
        <button type="button" onClick={save} className="btn-primary" disabled={saving || loading}>
          <Save className="size-4" /> {saving ? "Saving…" : "Save targets"}
        </button>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground py-10 text-center">Loading…</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-brand-cyan-light/40 text-left">
                <th className="px-3 py-2 font-semibold text-xs uppercase tracking-wide">SIF Business</th>
                <th className="px-3 py-2 font-semibold text-xs uppercase tracking-wide text-right">Target {fy}</th>
                <th className="px-3 py-2 font-semibold text-xs uppercase tracking-wide text-right">Actual {fy}</th>
                <th className="px-3 py-2 font-semibold text-xs uppercase tracking-wide text-right">%</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const p = pct(r.actual, r.target);
                const isTotal = r.kind === "branch_total" || r.kind === "firm_total";
                const rowCls =
                  r.kind === "firm_total"
                    ? "bg-brand-cyan-light/60 font-semibold border-t-2 border-border"
                    : r.kind === "branch_total"
                      ? "bg-muted/60 font-semibold border-t border-border"
                      : r.kind === "unassigned"
                        ? "bg-amber-50/30 border-t border-border text-muted-foreground"
                        : "border-t border-border";
                return (
                  <tr key={i} className={rowCls}>
                    <td className={`px-3 py-1.5 ${r.indent && !isTotal ? "pl-7" : ""}`}>{r.label}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {r.editable && r.scopeId ? (
                        <input
                          type="number"
                          min="0"
                          value={edits[r.scopeId] ?? ""}
                          onChange={(e) => setEdits((s) => ({ ...s, [r.scopeId as string]: e.target.value }))}
                          className="w-36 text-right tabular-nums bg-transparent border-b border-dashed border-border focus:outline-none focus:border-brand-cyan px-0.5 py-0.5 print:border-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                          placeholder="0"
                        />
                      ) : (
                        fmt(r.target)
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmt(r.actual)}</td>
                    <td className={`px-3 py-1.5 text-right tabular-nums ${p != null && p >= 100 ? "text-emerald-600" : p != null && p >= 50 ? "text-amber-600" : "text-rose-600"}`}>
                      {p != null ? `${p.toFixed(0)}%` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-muted-foreground print:hidden">
        Enter the FY target on each desk row (and on branches without desks). Branch subtotals, the “(No desk)”
        residual and the WCFW total are computed. Actual = SIF business booked in the year, attributed by the
        booking RM’s desk/branch. Set up desks under Settings → Desks.
      </p>
    </div>
  );
}
