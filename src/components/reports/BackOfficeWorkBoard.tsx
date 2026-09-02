"use client";

/**
 * Back-Office Work report — per branch, rectification work by particular
 * (Online/Offline × Value/No). A quick-add logs a tagged back-office task
 * (assigned to you → your branch).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Printer, Plus } from "lucide-react";
import { SelectField } from "@/components/ui/SelectField";
import { useToast } from "@/components/ui/Toast";
import type { BackOfficeWorkReport } from "@/lib/service/back-office-work";

type Payload = { branches: { id: string; name: string }[]; report: BackOfficeWorkReport | null };

const PARTICULARS = [
  ["purchase_rectified", "Purchase Transaction Rectified"],
  ["sip_rectified", "SIP Transaction Rectified"],
  ["nj_redemption", "NJ Redemption"],
  ["nj_wecare_switch", "NJ To WeCare Switch"],
  ["pms", "PMS"],
] as const;

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

export function BackOfficeWorkBoard() {
  const toast = useToast();
  const months = useMemo(() => recentMonths(), []);
  const [period, setPeriod] = useState(defaultPeriod());
  const [branch, setBranch] = useState("");
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [entry, setEntry] = useState({ particular: PARTICULARS[0][0] as string, channel: "online", value: "" });

  const load = useCallback(
    async (p: string, b: string) => {
      setLoading(true);
      try {
        const qs = new URLSearchParams({ period: p });
        if (b) qs.set("branch", b);
        const res = await fetch(`/api/reports/back-office-work?${qs}`, { cache: "no-store" });
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

  const addWork = async () => {
    setAdding(true);
    try {
      const label = PARTICULARS.find((p) => p[0] === entry.particular)?.[1] ?? "Back-office work";
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: label,
          type: "back_office_work",
          department: "back_office",
          subjectType: "internal",
          boParticular: entry.particular,
          boChannel: entry.channel,
          boValue: entry.value ? parseFloat(entry.value) : 0,
        }),
      });
      if (!res.ok) throw new Error();
      toast.success("Logged to your branch. Switch to your branch to see it.", "Added");
      setEntry({ particular: PARTICULARS[0][0], channel: "online", value: "" });
      load(period, branch);
    } catch {
      toast.error("Could not log the work.", "Failed");
    } finally {
      setAdding(false);
    }
  };

  const report = data?.report;
  const totals = useMemo(() => {
    if (!report) return null;
    const acc = { ov: 0, oc: 0, fv: 0, fc: 0, tv: 0, tc: 0 };
    for (const r of report.rows) {
      acc.ov += r.online.value; acc.oc += r.online.count;
      acc.fv += r.offline.value; acc.fc += r.offline.count;
      acc.tv += r.total.value; acc.tc += r.total.count;
    }
    return acc;
  }, [report]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <label className="text-sm">
          <span className="block text-muted-foreground mb-1">Branch</span>
          <SelectField className="w-48" value={branch} onChange={(e) => setBranch(e.target.value)}>
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

      {/* Quick add */}
      <div className="rounded-xl border border-border p-3 flex flex-wrap items-end gap-2 print:hidden">
        <span className="text-xs text-muted-foreground w-full">Log back-office work (to your branch):</span>
        <SelectField className="w-56" value={entry.particular} onChange={(e) => setEntry((s) => ({ ...s, particular: e.target.value }))}>
          {PARTICULARS.map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </SelectField>
        <SelectField className="w-32" value={entry.channel} onChange={(e) => setEntry((s) => ({ ...s, channel: e.target.value }))}>
          <option value="online">Online</option>
          <option value="offline">Offline</option>
        </SelectField>
        <input
          type="number"
          min="0"
          value={entry.value}
          onChange={(e) => setEntry((s) => ({ ...s, value: e.target.value }))}
          placeholder="Value ₹"
          className="w-32 rounded-md border border-border px-2 py-1.5 text-sm focus:outline-none focus:border-brand-cyan"
        />
        <button type="button" onClick={addWork} disabled={adding} className="btn-primary">
          <Plus className="size-4" /> Log
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
              <tr className="bg-brand-cyan-light/40 text-center">
                <th rowSpan={2} className="px-3 py-2 font-semibold text-xs uppercase tracking-wide text-left">{report.branchName}</th>
                <th colSpan={2} className="px-3 py-1.5 font-semibold text-xs uppercase tracking-wide border-l border-border">Online</th>
                <th colSpan={2} className="px-3 py-1.5 font-semibold text-xs uppercase tracking-wide border-l border-border">Offline</th>
                <th colSpan={2} className="px-3 py-1.5 font-semibold text-xs uppercase tracking-wide border-l border-border">Total</th>
              </tr>
              <tr className="bg-brand-cyan-light/20 text-right text-[11px] text-muted-foreground uppercase">
                <th className="px-3 py-1 border-l border-border">Value</th><th className="px-3 py-1">No.</th>
                <th className="px-3 py-1 border-l border-border">Value</th><th className="px-3 py-1">No.</th>
                <th className="px-3 py-1 border-l border-border">Value</th><th className="px-3 py-1">No.</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((r) => (
                <tr key={r.label} className="border-t border-border">
                  <td className="px-3 py-1.5">{r.label}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums border-l border-border">{money(r.online.value)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{r.online.count}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums border-l border-border">{money(r.offline.value)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{r.offline.count}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums border-l border-border">{money(r.total.value)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{r.total.count}</td>
                </tr>
              ))}
              {totals && (
                <tr className="border-t-2 border-border bg-brand-cyan-light/60 font-semibold">
                  <td className="px-3 py-1.5">Total</td>
                  <td className="px-3 py-1.5 text-right tabular-nums border-l border-border">{money(totals.ov)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{totals.oc}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums border-l border-border">{money(totals.fv)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{totals.fc}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums border-l border-border">{money(totals.tv)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{totals.tc}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-muted-foreground print:hidden">
        Rectification work logged as back-office tasks, grouped by particular and channel, by the staff member's
        branch. Source: Tasks (Back-Office classification).
      </p>
    </div>
  );
}
