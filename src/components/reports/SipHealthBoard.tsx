"use client";

/** SIP Health pack + EFFORTS snapshot — Live SIP, Net SIP, Maturing, Bounced. */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Printer } from "lucide-react";
import { SelectField } from "@/components/ui/SelectField";
import { useToast } from "@/components/ui/Toast";
import type { SipHealth } from "@/lib/finance/sip-health";

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

function Card({ title, value, sub, tone }: { title: string; value: string; sub?: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-xl border border-border p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{title}</div>
      <div className={`text-xl font-bold mt-1 tabular-nums ${tone === "good" ? "text-emerald-600" : tone === "bad" ? "text-rose-600" : ""}`}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

export function SipHealthBoard() {
  const toast = useToast();
  const months = useMemo(() => recentMonths(), []);
  const [period, setPeriod] = useState(defaultPeriod());
  const [data, setData] = useState<SipHealth | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (p: string) => {
      setLoading(true);
      try {
        const res = await fetch(`/api/reports/sip-health?period=${p}`, { cache: "no-store" });
        if (!res.ok) throw new Error();
        setData(await res.json());
      } catch {
        toast.error("Could not load SIP health.", "Load failed");
      } finally {
        setLoading(false);
      }
    },
    [toast]
  );

  useEffect(() => {
    load(period);
  }, [period, load]);

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

      {loading || !data ? (
        <div className="text-sm text-muted-foreground py-10 text-center">Loading…</div>
      ) : (
        <div className="space-y-6">
          <div>
            <h2 className="text-sm font-semibold mb-2">SIP Health</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <Card title="Live SIP (book)" value={money(data.liveSip.amount)} sub={`${data.liveSip.count} SIPs`} />
              <Card title="Fresh SIP (this month)" value={money(data.fresh.amount)} sub={`New ${money(data.freshNew)} · Existing ${money(data.freshExisting)}`} tone="good" />
              <Card title="Stopped SIP (this month)" value={money(data.stopped.amount)} sub={`${data.stopped.count} stopped`} tone="bad" />
              <Card title="Net SIP" value={money(data.netSip)} sub="Fresh − Stopped" tone={data.netSip >= 0 ? "good" : "bad"} />
              <Card title="Maturing this month" value={money(data.maturing.amount)} sub={`${data.maturing.count} SIPs`} />
              <Card title="Bounced / Rejected" value={money(data.bounced.amount)} sub={`${data.bounced.count} this month`} tone="bad" />
            </div>
          </div>

          <div>
            <h2 className="text-sm font-semibold mb-2">Efforts (this month)</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <Card title="New Leads" value={String(data.efforts.newLeads)} />
              <Card title="Review Meetings done" value={String(data.efforts.reviewsDone)} />
              <Card title="Tasks completed" value={String(data.efforts.tasksCompleted)} />
            </div>
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground print:hidden">
        Live SIP from the client book; Fresh/Stopped from Business Entries (SIP / SIP-Stop); Maturing from SIP
        end-dates; Bounced from SIP transactions. Efforts are actuals booked this month.
      </p>
    </div>
  );
}
