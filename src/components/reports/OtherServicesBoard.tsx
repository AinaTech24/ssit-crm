"use client";

/** Back-Office "Other Services" — service-request counts per type per branch. */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Printer } from "lucide-react";
import { SelectField } from "@/components/ui/SelectField";
import { useToast } from "@/components/ui/Toast";
import type { OtherServicesReport } from "@/lib/service/other-services-report";

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

export function OtherServicesBoard() {
  const toast = useToast();
  const months = useMemo(() => recentMonths(), []);
  const [period, setPeriod] = useState(defaultPeriod());
  const [data, setData] = useState<OtherServicesReport | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (p: string) => {
      setLoading(true);
      try {
        const res = await fetch(`/api/reports/other-services?period=${p}`, { cache: "no-store" });
        if (!res.ok) throw new Error();
        setData(await res.json());
      } catch {
        toast.error("Could not load the report.", "Load failed");
      } finally {
        setLoading(false);
      }
    },
    [toast]
  );

  useEffect(() => {
    load(period);
  }, [period, load]);

  const totals = useMemo(() => {
    if (!data) return [];
    return data.branches.map((_, ci) => data.rows.reduce((sum, r) => sum + (r.counts[ci] ?? 0), 0));
  }, [data]);

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
        <button type="button" onClick={() => window.print()} className="btn-secondary">
          <Printer className="size-4" /> Print
        </button>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground py-10 text-center">Loading…</div>
      ) : !data ? (
        <div className="text-sm text-muted-foreground py-10 text-center">No data.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-brand-cyan-light/40 text-left">
                <th className="px-3 py-2 font-semibold text-xs uppercase tracking-wide w-12 text-center">Sr.</th>
                <th className="px-3 py-2 font-semibold text-xs uppercase tracking-wide">Particulars</th>
                {data.branches.map((b) => (
                  <th key={b.id} className="px-3 py-2 font-semibold text-xs uppercase tracking-wide text-right">
                    {b.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r, i) => (
                <tr key={r.label} className="border-t border-border">
                  <td className="px-3 py-1.5 text-center text-muted-foreground">{i + 1}</td>
                  <td className="px-3 py-1.5">{r.label}</td>
                  {r.counts.map((c, ci) => (
                    <td key={ci} className="px-3 py-1.5 text-right tabular-nums">
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="border-t-2 border-border bg-brand-cyan-light/60 font-semibold">
                <td className="px-3 py-1.5" />
                <td className="px-3 py-1.5">Total</td>
                {totals.map((t, ci) => (
                  <td key={ci} className="px-3 py-1.5 text-right tabular-nums">
                    {t}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-muted-foreground print:hidden">
        Service requests logged in the month, counted by type and the client's branch. New particulars (IIN, CAN,
        SWP, Video KYC…) are available as service-request types.
      </p>
    </div>
  );
}
