"use client";

/** Net-Sales matrix — Gross / Redemption / Net by platform, for a product + month. */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Printer } from "lucide-react";
import { SelectField } from "@/components/ui/SelectField";
import { useToast } from "@/components/ui/Toast";
import { PRODUCT_OPTIONS, type NetSalesMatrix } from "@/lib/business/net-sales-matrix";

const money = (n: number) => "₹ " + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });

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

export function NetSalesBoard() {
  const toast = useToast();
  const months = useMemo(() => recentMonths(), []);
  const [period, setPeriod] = useState(defaultPeriod());
  const [product, setProduct] = useState("mutual_fund");
  const [data, setData] = useState<NetSalesMatrix | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (p: string, prod: string) => {
      setLoading(true);
      try {
        const res = await fetch(`/api/reports/net-sales?product=${prod}&period=${p}`, { cache: "no-store" });
        if (!res.ok) throw new Error();
        setData(await res.json());
      } catch {
        toast.error("Could not load the matrix.", "Load failed");
      } finally {
        setLoading(false);
      }
    },
    [toast]
  );

  useEffect(() => {
    load(period, product);
  }, [period, product, load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <label className="text-sm">
          <span className="block text-muted-foreground mb-1">Product</span>
          <SelectField className="w-44" value={product} onChange={(e) => setProduct(e.target.value)}>
            {PRODUCT_OPTIONS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
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
      ) : !data || data.rows.length === 0 ? (
        <div className="text-sm text-muted-foreground py-10 text-center">No business booked for this month/product.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border max-w-3xl">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-brand-cyan-light/40 text-left">
                <th className="px-3 py-2 font-semibold text-xs uppercase tracking-wide">Platform</th>
                <th className="px-3 py-2 font-semibold text-xs uppercase tracking-wide text-right">Gross Sales</th>
                <th className="px-3 py-2 font-semibold text-xs uppercase tracking-wide text-right">Redemption</th>
                <th className="px-3 py-2 font-semibold text-xs uppercase tracking-wide text-right">Net Sales</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r, i) => (
                <tr
                  key={i}
                  className={
                    r.kind === "platform_total"
                      ? "border-t-2 border-border bg-brand-cyan-light/30 font-semibold"
                      : "border-t border-border/50"
                  }
                >
                  <td className={`px-3 py-1.5 ${r.indent ? "pl-7 text-muted-foreground" : "font-medium"}`}>{r.label}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{money(r.gross)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{money(r.redemption)}</td>
                  <td className={`px-3 py-1.5 text-right tabular-nums ${r.net < 0 ? "text-rose-600" : ""}`}>{money(r.net)}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-border bg-brand-cyan-light/60 font-bold">
                <td className="px-3 py-1.5">Grand Total</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{money(data.total.gross)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{money(data.total.redemption)}</td>
                <td className={`px-3 py-1.5 text-right tabular-nums ${data.total.net < 0 ? "text-rose-600" : ""}`}>{money(data.total.net)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-muted-foreground print:hidden">
        Net = Gross − Redemption, by execution platform. Set a platform on each business entry to populate this.
      </p>
    </div>
  );
}
