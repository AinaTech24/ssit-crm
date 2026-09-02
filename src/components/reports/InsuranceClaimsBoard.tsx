"use client";

/** Insurance Claims summary — Logged / Settled / Pending / File-not-received. */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Printer } from "lucide-react";
import { SelectField } from "@/components/ui/SelectField";
import { useToast } from "@/components/ui/Toast";
import type { ClaimRow } from "@/lib/insurance/claims-summary";

type Payload = { branches: { id: string; name: string }[]; period: string; rows: ClaimRow[] };

const money = (n: number | null) => (n == null ? "" : "₹ " + n.toLocaleString("en-IN", { maximumFractionDigits: 0 }));

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

export function InsuranceClaimsBoard() {
  const toast = useToast();
  const months = useMemo(() => recentMonths(), []);
  const [period, setPeriod] = useState(defaultPeriod());
  const [branch, setBranch] = useState("");
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (p: string, b: string) => {
      setLoading(true);
      try {
        const qs = new URLSearchParams({ period: p });
        if (b) qs.set("branch", b);
        const res = await fetch(`/api/reports/insurance-claims?${qs}`, { cache: "no-store" });
        if (!res.ok) throw new Error();
        setData(await res.json());
      } catch {
        toast.error("Could not load claims.", "Load failed");
      } finally {
        setLoading(false);
      }
    },
    [toast]
  );

  useEffect(() => {
    load(period, branch);
  }, [period, branch, load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <label className="text-sm">
          <span className="block text-muted-foreground mb-1">Branch</span>
          <SelectField className="w-52" value={branch} onChange={(e) => setBranch(e.target.value)}>
            <option value="">All branches</option>
            {(data?.branches ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </SelectField>
        </label>
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
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border max-w-2xl">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-brand-cyan-light/40 text-left">
                <th className="px-3 py-2 font-semibold text-xs uppercase tracking-wide w-12 text-center">Sr.</th>
                <th className="px-3 py-2 font-semibold text-xs uppercase tracking-wide">Claim Data</th>
                <th className="px-3 py-2 font-semibold text-xs uppercase tracking-wide text-right">In Numbers</th>
                <th className="px-3 py-2 font-semibold text-xs uppercase tracking-wide text-right">Amount</th>
                <th className="px-3 py-2 font-semibold text-xs uppercase tracking-wide text-right">Claim Settled</th>
              </tr>
            </thead>
            <tbody>
              {(data?.rows ?? []).map((r, i) => (
                <tr key={r.label} className="border-t border-border">
                  <td className="px-3 py-1.5 text-center text-muted-foreground">{i + 1}</td>
                  <td className="px-3 py-1.5 font-medium">{r.label}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{r.count}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{money(r.amount)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{money(r.settled)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-muted-foreground print:hidden">
        Logged = intimated in the month; Settled = settled in the month; Pending &amp; File-Not-Received are the
        current open snapshot. Source: Insurance Claims module.
      </p>
    </div>
  );
}
