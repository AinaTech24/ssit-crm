"use client";

/**
 * Branch-wise monthly-metric MIS report — the monthly-meeting table for any
 * metric of the same shape (AUM Status, SIP Book Size, …). Driven by the metric
 * registry (src/lib/finance/metric-config.ts).
 *
 * Pick a month → each branch's value is pre-filled from the live CRM rollup
 * (editable to the firm's authoritative figure); FY targets and external sources
 * carry forward from the prior month. The board computes % achievement and the
 * month-on-month delta, with a WCFW (branch) subtotal and a grand total, then
 * saves the month's snapshot.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, Trash2, Save, Printer, RefreshCw, ArrowUp, ArrowDown } from "lucide-react";
import { SelectField } from "@/components/ui/SelectField";
import { useToast } from "@/components/ui/Toast";
import { METRICS, fyLabel, type MetricKey } from "@/lib/finance/metric-config";
import type { MetricStatus } from "@/lib/finance/metric-status";

type EditBranch = {
  branchId: string;
  name: string;
  target: string;
  value: string;
  prevValue: number | null;
  liveValue: number;
};
type EditExt = { uid: number; name: string; target: string; value: string; prevValue: number | null };

const num = (s: string | number | null | undefined): number => {
  const x = typeof s === "number" ? s : parseFloat(String(s ?? ""));
  return Number.isFinite(x) ? x : 0;
};
const fmt = (n: number): string =>
  n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Last closed month (the one a monthly review covers) as 'YYYY-MM'. */
function defaultPeriod(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function recentMonths(count = 24): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  const d = new Date();
  d.setDate(1);
  for (let i = 0; i < count; i++) {
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleString("en-IN", { month: "long", year: "numeric" });
    out.push({ value, label });
    d.setMonth(d.getMonth() - 1);
  }
  return out;
}

export function MetricStatusBoard({ metricKey }: { metricKey: MetricKey }) {
  const meta = METRICS[metricKey];
  const toast = useToast();
  const months = useMemo(() => recentMonths(), []);
  const [period, setPeriod] = useState<string>(defaultPeriod());
  const [data, setData] = useState<MetricStatus | null>(null);
  const [branchRows, setBranchRows] = useState<EditBranch[]>([]);
  const [extRows, setExtRows] = useState<EditExt[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const uidRef = useRef(1);

  const hydrate = useCallback((d: MetricStatus) => {
    setData(d);
    setBranchRows(
      d.branches.map((b) => ({
        branchId: b.branchId as string,
        name: b.name,
        target: b.target != null ? String(b.target) : "",
        value: b.value != null ? String(b.value) : "",
        prevValue: b.prevValue,
        liveValue: b.liveValue ?? 0,
      }))
    );
    setExtRows(
      d.externals.map((e) => ({
        uid: uidRef.current++,
        name: e.name,
        target: e.target != null ? String(e.target) : "",
        value: e.value != null ? String(e.value) : "",
        prevValue: e.prevValue,
      }))
    );
  }, []);

  const load = useCallback(
    async (p: string) => {
      setLoading(true);
      try {
        const res = await fetch(`/api/reports/metric-status?metric=${metricKey}&period=${p}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error("load failed");
        hydrate(await res.json());
      } catch {
        toast.error("Could not load this month's figures.", "Load failed");
      } finally {
        setLoading(false);
      }
    },
    [hydrate, toast, metricKey]
  );

  useEffect(() => {
    load(period);
  }, [period, load]);

  const setBranch = (i: number, key: "target" | "value", v: string) =>
    setBranchRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, [key]: v } : r)));
  const setExt = (i: number, key: "name" | "target" | "value", v: string) =>
    setExtRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, [key]: v } : r)));
  const addExt = () =>
    setExtRows((rows) => [...rows, { uid: uidRef.current++, name: "", target: "", value: "", prevValue: null }]);
  const removeExt = (i: number) => setExtRows((rows) => rows.filter((_, idx) => idx !== i));

  const pullLive = () => {
    setBranchRows((rows) => rows.map((r) => ({ ...r, value: String(r.liveValue) })));
    toast.info(`Branch ${meta.label} reset to the live CRM figure. Review, then Save.`, "Pulled from CRM");
  };

  const branchTotals = useMemo(
    () =>
      branchRows.reduce(
        (a, r) => ({
          target: a.target + num(r.target),
          value: a.value + num(r.value),
          prev: a.prev + num(r.prevValue),
        }),
        { target: 0, value: 0, prev: 0 }
      ),
    [branchRows]
  );
  const extTotals = useMemo(
    () =>
      extRows.reduce(
        (a, r) => ({
          target: a.target + num(r.target),
          value: a.value + num(r.value),
          prev: a.prev + num(r.prevValue),
        }),
        { target: 0, value: 0, prev: 0 }
      ),
    [extRows]
  );
  const grand = {
    target: branchTotals.target + extTotals.target,
    value: branchTotals.value + extTotals.value,
    prev: branchTotals.prev + extTotals.prev,
  };

  const save = async () => {
    setSaving(true);
    try {
      const rows = [
        ...branchRows.map((r) => ({
          sourceType: "branch" as const,
          branchId: r.branchId,
          name: r.name,
          value: num(r.value),
          target: r.target.trim() === "" ? null : num(r.target),
        })),
        ...extRows
          .filter((r) => r.name.trim().length > 0)
          .map((r) => ({
            sourceType: "external" as const,
            name: r.name.trim(),
            value: num(r.value),
            target: r.target.trim() === "" ? null : num(r.target),
          })),
      ];
      const res = await fetch("/api/reports/metric-status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ metric: metricKey, period, rows }),
      });
      if (!res.ok) throw new Error("save failed");
      hydrate(await res.json());
      toast.success(`${meta.title} saved for this month.`, "Saved");
    } catch {
      toast.error("Could not save. Please retry.", "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const asOn = data?.asOnLabel ?? "";
  const prevAsOn = data?.prevAsOnLabel ?? "";
  const targetHdr = `Target ${fyLabel(period)} (${meta.unit})`;

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <label className="text-sm">
          <span className="block text-muted-foreground mb-1">Month</span>
          <SelectField className="w-52" value={period} onChange={(e) => setPeriod(e.target.value)}>
            {months.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </SelectField>
        </label>
        <div className="flex-1" />
        <button type="button" onClick={pullLive} className="btn-secondary" disabled={loading}>
          <RefreshCw className="size-4" /> Pull live {meta.label} from CRM
        </button>
        <button type="button" onClick={() => window.print()} className="btn-secondary">
          <Printer className="size-4" /> Print
        </button>
        <button type="button" onClick={save} className="btn-primary" disabled={saving || loading}>
          <Save className="size-4" /> {saving ? "Saving…" : "Save"}
        </button>
      </div>

      <div className="text-center hidden print:block">
        <h2 className="text-lg font-bold">
          {meta.title} — As On {asOn}
        </h2>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground py-10 text-center">Loading…</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-brand-cyan-light/40 text-left">
                <Th className="w-12 text-center">Sr.</Th>
                <Th>Name</Th>
                <Th className="text-right">{targetHdr}</Th>
                <Th className="text-right">
                  {meta.asOnPrefix} {asOn} ({meta.unit})
                </Th>
                <Th className="text-right">% Achiev.</Th>
                <Th className="text-right">
                  {meta.asOnPrefix} {prevAsOn} ({meta.unit})
                </Th>
                <Th className="text-right">MoM</Th>
                <Th className="w-10 print:hidden" />
              </tr>
            </thead>
            <tbody>
              {branchRows.map((r, i) => (
                <tr key={r.branchId} className="border-t border-border">
                  <Td className="text-center text-muted-foreground">{i + 1}</Td>
                  <Td className="font-medium">{r.name}</Td>
                  <Td className="text-right">
                    <NumInput value={r.target} onChange={(v) => setBranch(i, "target", v)} />
                  </Td>
                  <Td className="text-right">
                    <NumInput value={r.value} onChange={(v) => setBranch(i, "value", v)} />
                  </Td>
                  <Achiev value={num(r.value)} target={num(r.target)} />
                  <Td className="text-right tabular-nums text-muted-foreground">
                    {r.prevValue != null ? fmt(r.prevValue) : "—"}
                  </Td>
                  <Mom value={num(r.value)} prev={r.prevValue} />
                  <Td className="print:hidden" />
                </tr>
              ))}

              <TotalRow label="WCFW Total" t={branchTotals} strong />

              {extRows.map((r, i) => (
                <tr key={r.uid} className="border-t border-border bg-amber-50/30">
                  <Td className="text-center text-muted-foreground">{branchRows.length + i + 1}</Td>
                  <Td>
                    <input
                      value={r.name}
                      onChange={(e) => setExt(i, "name", e.target.value)}
                      placeholder="External source (e.g. Reliance Securities)"
                      className="w-full bg-transparent border-b border-dashed border-border focus:outline-none focus:border-brand-cyan px-0.5 py-0.5 print:border-none"
                    />
                  </Td>
                  <Td className="text-right">
                    <NumInput value={r.target} onChange={(v) => setExt(i, "target", v)} />
                  </Td>
                  <Td className="text-right">
                    <NumInput value={r.value} onChange={(v) => setExt(i, "value", v)} />
                  </Td>
                  <Achiev value={num(r.value)} target={num(r.target)} />
                  <Td className="text-right tabular-nums text-muted-foreground">
                    {r.prevValue != null ? fmt(r.prevValue) : "—"}
                  </Td>
                  <Mom value={num(r.value)} prev={r.prevValue} />
                  <Td className="text-center print:hidden">
                    <button
                      type="button"
                      onClick={() => removeExt(i)}
                      className="text-muted-foreground hover:text-rose-600"
                      aria-label="Remove source"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </Td>
                </tr>
              ))}

              <tr className="print:hidden">
                <Td />
                <Td colSpan={6}>
                  <button
                    type="button"
                    onClick={addExt}
                    className="text-xs text-brand-cyan-deep hover:underline inline-flex items-center gap-1"
                  >
                    <Plus className="size-3.5" /> Add external source
                  </button>
                </Td>
                <Td />
              </tr>

              <TotalRow label="Total" t={grand} strong grand />
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-muted-foreground print:hidden">
        Branch {meta.label} is pre-filled from the live CRM figure for that branch — edit any cell to match your
        authoritative figure, then Save. Targets and external sources carry forward to next month automatically.
        The previous-month and MoM columns fill in once a prior month is saved.
      </p>
    </div>
  );
}

function Th({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 font-semibold text-xs uppercase tracking-wide ${className}`}>{children}</th>;
}
function Td({
  children,
  className = "",
  colSpan,
}: {
  children?: React.ReactNode;
  className?: string;
  colSpan?: number;
}) {
  return (
    <td colSpan={colSpan} className={`px-3 py-1.5 ${className}`}>
      {children}
    </td>
  );
}

function NumInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="number"
      inputMode="decimal"
      step="0.01"
      min="0"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-24 text-right tabular-nums bg-transparent border-b border-dashed border-border focus:outline-none focus:border-brand-cyan px-0.5 py-0.5 print:border-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      placeholder="0.00"
    />
  );
}

function Achiev({ value, target }: { value: number; target: number }) {
  if (!(target > 0)) return <Td className="text-right text-muted-foreground">—</Td>;
  const pct = (value / target) * 100;
  const color = pct >= 100 ? "text-emerald-600" : pct >= 75 ? "text-amber-600" : "text-rose-600";
  return <Td className={`text-right tabular-nums font-medium ${color}`}>{pct.toFixed(1)}%</Td>;
}

function Mom({ value, prev }: { value: number; prev: number | null }) {
  if (prev == null) return <Td className="text-right text-muted-foreground">—</Td>;
  const delta = value - prev;
  const pct = prev !== 0 ? (delta / prev) * 100 : null;
  const up = delta >= 0;
  const color = up ? "text-emerald-600" : "text-rose-600";
  const Icon = up ? ArrowUp : ArrowDown;
  return (
    <Td className={`text-right tabular-nums ${color}`}>
      <span className="inline-flex items-center justify-end gap-0.5">
        <Icon className="size-3" />
        {fmt(Math.abs(delta))}
        {pct != null && <span className="text-[11px] opacity-80">({pct.toFixed(1)}%)</span>}
      </span>
    </Td>
  );
}

function TotalRow({
  label,
  t,
  strong,
  grand,
}: {
  label: string;
  t: { target: number; value: number; prev: number };
  strong?: boolean;
  grand?: boolean;
}) {
  const base = grand ? "bg-brand-cyan-light/60" : "bg-muted/60";
  return (
    <tr className={`border-t-2 border-border ${base} ${strong ? "font-semibold" : ""}`}>
      <Td />
      <Td>{label}</Td>
      <Td className="text-right tabular-nums">{fmt(t.target)}</Td>
      <Td className="text-right tabular-nums">{fmt(t.value)}</Td>
      <Achiev value={t.value} target={t.target} />
      <Td className="text-right tabular-nums">{fmt(t.prev)}</Td>
      <Mom value={t.value} prev={t.prev} />
      <Td className="print:hidden" />
    </tr>
  );
}
