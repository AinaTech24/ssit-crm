"use client";

/**
 * Insurance advisor-production report — Personal Lines + Commercial/General Lines,
 * each category × New/Renewal, for one advisor + FY. Read-only, computed live.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Printer } from "lucide-react";
import { SelectField } from "@/components/ui/SelectField";
import { useToast } from "@/components/ui/Toast";
import type { AdvisorProduction, ProdRow } from "@/lib/insurance/advisor-production";

type Payload = { advisors: { id: string; name: string }[]; production: AdvisorProduction | null };

function recentFYs(count = 5): string[] {
  const d = new Date();
  const startY = d.getMonth() + 1 >= 4 ? d.getFullYear() : d.getFullYear() - 1;
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const y = startY - i + 1;
    out.push(`${y}-${String((y + 1) % 100).padStart(2, "0")}`);
  }
  return out;
}

export function InsuranceProductionBoard() {
  const toast = useToast();
  const fys = useMemo(() => recentFYs(), []);
  const [fy, setFy] = useState(fys[1] ?? fys[0]);
  const [advisor, setAdvisor] = useState("");
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (f: string, a: string) => {
      setLoading(true);
      try {
        const qs = new URLSearchParams({ fy: f });
        if (a) qs.set("advisor", a);
        const res = await fetch(`/api/reports/insurance-production?${qs}`, { cache: "no-store" });
        if (!res.ok) throw new Error();
        const d = await res.json();
        setData(d);
        if (d.production?.advisorId) setAdvisor(d.production.advisorId);
      } catch {
        toast.error("Could not load insurance production.", "Load failed");
      } finally {
        setLoading(false);
      }
    },
    [toast]
  );

  useEffect(() => {
    load(fy, advisor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fy, advisor]);

  const prod = data?.production;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <label className="text-sm">
          <span className="block text-muted-foreground mb-1">Advisor</span>
          <SelectField className="w-56" value={advisor} onChange={(e) => setAdvisor(e.target.value)}>
            {(data?.advisors ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </SelectField>
        </label>
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
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground py-10 text-center">Loading…</div>
      ) : !prod ? (
        <div className="text-sm text-muted-foreground py-10 text-center">No advisors found.</div>
      ) : (
        <div className="space-y-5">
          <div className="text-center font-bold">{prod.advisorName}</div>
          <div className="grid md:grid-cols-2 gap-5">
            <LinesTable title={`Personal Lines ${prod.fiscalYear}`} rows={prod.personal} />
            <LinesTable title={`Commercial / General Lines ${prod.fiscalYear}`} rows={prod.commercial} />
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground print:hidden">
        Annual premium of policies sold in the FY (risk-cover start in the year), by category and New/Renewal.
        Source: Insurance module. Mark a policy's “Business type” (New/Renewal) on the policy form.
      </p>
    </div>
  );
}

function LinesTable({ title, rows }: { title: string; rows: ProdRow[] }) {
  const money = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const totNew = rows.reduce((a, r) => a + r.newPrem, 0);
  const totRen = rows.reduce((a, r) => a + r.renewalPrem, 0);
  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <div className="px-3 py-2 bg-brand-cyan-light/40 font-semibold text-sm">{title}</div>
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="text-left border-b border-border">
            <th className="px-3 py-1.5 font-medium text-xs text-muted-foreground" />
            <th className="px-3 py-1.5 font-medium text-xs text-muted-foreground text-right">New</th>
            <th className="px-3 py-1.5 font-medium text-xs text-muted-foreground text-right">Renewal</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-border/60">
              <td className="px-3 py-1.5">{r.label}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{money(r.newPrem)}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{money(r.renewalPrem)}</td>
            </tr>
          ))}
          <tr className="border-t-2 border-border bg-muted/60 font-semibold">
            <td className="px-3 py-1.5">TOTAL</td>
            <td className="px-3 py-1.5 text-right tabular-nums">{money(totNew)}</td>
            <td className="px-3 py-1.5 text-right tabular-nums">{money(totRen)}</td>
          </tr>
          <tr className="bg-brand-cyan-light/30 font-semibold">
            <td className="px-3 py-1.5">Total (New + Renewal)</td>
            <td className="px-3 py-1.5 text-right tabular-nums" colSpan={2}>
              {money(totNew + totRen)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
