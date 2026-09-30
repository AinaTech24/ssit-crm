"use client";

/**
 * SIP Rejection, Pending & Repurchase — per branch, RMs grouped by desk with
 * desk subtotals + branch total. Read-only, computed live.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Printer } from "lucide-react";
import { SelectField } from "@/components/ui/SelectField";
import { useToast } from "@/components/ui/Toast";
import type { SipRejReport, SipRejRow } from "@/lib/business/sip-rejection-report";

type Payload = { branches: { id: string; name: string }[]; report: SipRejReport | null };

const money = (n: number) => "₹ " + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
const count = (n: number) => n.toLocaleString("en-IN");

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

// Money columns are indices 0,2,4; count columns 1,3,5.
const isMoneyCol = (i: number) => i % 2 === 0;

export function SipRejectionBoard() {
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
        const res = await fetch(`/api/reports/sip-rejection?${qs}`, { cache: "no-store" });
        if (!res.ok) throw new Error();
        const d = await res.json();
        setData(d);
        if (d.report?.branchId) setBranch(d.report.branchId);
      } catch {
        toast.error("Could not load the report.", "Load failed");
      } finally {
        setLoading(false);
      }
    },
    [toast]
  );

  useEffect(() => {
    load(period, branch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, branch]);

  const report = data?.report;
  const cell = (v: number, i: number) => (isMoneyCol(i) ? money(v) : count(v));
  const rowClass = (k: SipRejRow["kind"]) =>
    k === "branch_total"
      ? "bg-brand-cyan-light/60 font-semibold border-t-2 border-border"
      : k === "desk_total"
        ? "bg-muted/60 font-semibold border-t border-border"
        : "border-t border-border/60";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <label className="text-sm">
          <span className="block text-muted-foreground mb-1">Branch</span>
          <SelectField className="w-52" value={branch} onChange={(e) => setBranch(e.target.value)}>
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
      ) : !report ? (
        <div className="text-sm text-muted-foreground py-10 text-center">No branches found.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-brand-cyan-light/40 text-left">
                <th className="px-3 py-2 font-semibold text-xs uppercase tracking-wide">{report.branchName}</th>
                {report.columns.map((c) => (
                  <th key={c} className="px-3 py-2 font-semibold text-xs uppercase tracking-wide text-right">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.rows.map((r, i) => (
                <tr key={i} className={rowClass(r.kind)}>
                  <td className={`px-3 py-1.5 ${r.indent ? "pl-6" : ""}`}>{r.label}</td>
                  {r.values.map((v, ci) => (
                    <td key={ci} className="px-3 py-1.5 text-right tabular-nums">
                      {cell(v, ci)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-muted-foreground print:hidden">
        Rejection &amp; Pending from SIP transactions (by the client's RM); Add. Purchase from Transactions.
        Grouped by desk; assign RMs under Settings → Desks.
      </p>
    </div>
  );
}
