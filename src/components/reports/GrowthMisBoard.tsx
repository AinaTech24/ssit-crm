"use client";

/**
 * Unified Growth MIS (Finowise "EFFORTS × EFFECTIVENESS = RESULT") — one screen
 * tying Efforts (Plan vs Actual) to Results (Net Sales + SIP Health), per month.
 * Read-only summary; deep-links to each full report.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Printer, ArrowRight } from "lucide-react";
import { SelectField } from "@/components/ui/SelectField";
import { useToast } from "@/components/ui/Toast";
import type { EffortsStatus } from "@/lib/finance/efforts";
import type { SipHealth } from "@/lib/finance/sip-health";
import type { NetSalesMatrix } from "@/lib/business/net-sales-matrix";

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

export function GrowthMisBoard() {
  const toast = useToast();
  const months = useMemo(() => recentMonths(), []);
  const [period, setPeriod] = useState(defaultPeriod());
  const [efforts, setEfforts] = useState<EffortsStatus | null>(null);
  const [sip, setSip] = useState<SipHealth | null>(null);
  const [net, setNet] = useState<NetSalesMatrix | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (p: string) => {
      setLoading(true);
      try {
        const [e, s, nm] = await Promise.all([
          fetch(`/api/reports/efforts?period=${p}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
          fetch(`/api/reports/sip-health?period=${p}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
          fetch(`/api/reports/net-sales?product=__all__&period=${p}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
        ]);
        setEfforts(e);
        setSip(s);
        setNet(nm);
      } catch {
        toast.error("Could not load the Growth MIS.", "Load failed");
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
    <div className="space-y-5">
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

      <div className="text-center rounded-xl border border-border bg-brand-cyan-light/30 py-3 font-bold tracking-wide">
        EFFORTS × EFFECTIVENESS = RESULT
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground py-10 text-center">Loading…</div>
      ) : (
        <div className="grid md:grid-cols-2 gap-5">
          {/* EFFORTS */}
          <Section title="Efforts" href="/dashboard/reports/efforts">
            {efforts ? (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground text-left">
                    <th className="py-1">Activity</th>
                    <th className="py-1 text-right">Plan</th>
                    <th className="py-1 text-right">Actual</th>
                    <th className="py-1 text-right">%</th>
                  </tr>
                </thead>
                <tbody>
                  {efforts.rows.map((r) => {
                    const pct = r.planned > 0 ? (r.actual / r.planned) * 100 : null;
                    return (
                      <tr key={r.key} className="border-t border-border/50">
                        <td className="py-1">{r.label}</td>
                        <td className="py-1 text-right tabular-nums">{r.planned || "—"}</td>
                        <td className="py-1 text-right tabular-nums">{r.actual || "—"}</td>
                        <td className={`py-1 text-right tabular-nums ${pct != null && pct >= 100 ? "text-emerald-600" : pct != null && pct >= 50 ? "text-amber-600" : pct != null ? "text-rose-600" : ""}`}>
                          {pct != null ? `${pct.toFixed(0)}%` : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <Empty />
            )}
          </Section>

          {/* RESULTS — SIP Health */}
          <Section title="Results — SIP Health" href="/dashboard/reports/sip-health">
            {sip ? (
              <div className="grid grid-cols-2 gap-2 text-sm">
                <Stat label="Live SIP" value={money(sip.liveSip.amount)} />
                <Stat label="Net SIP" value={money(sip.netSip)} tone={sip.netSip >= 0 ? "good" : "bad"} />
                <Stat label="Fresh (New/Exist.)" value={`${money(sip.freshNew)} / ${money(sip.freshExisting)}`} />
                <Stat label="Stopped" value={money(sip.stopped.amount)} tone="bad" />
                <Stat label="Maturing" value={money(sip.maturing.amount)} />
                <Stat label="Bounced" value={money(sip.bounced.amount)} tone="bad" />
              </div>
            ) : (
              <Empty />
            )}
          </Section>

          {/* RESULTS — Net Sales */}
          <Section title="Results — Net Sales (all products)" href="/dashboard/reports/net-sales" wide>
            {net && net.rows.length ? (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground text-left">
                    <th className="py-1">Platform</th>
                    <th className="py-1 text-right">Gross</th>
                    <th className="py-1 text-right">Redemption</th>
                    <th className="py-1 text-right">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {net.rows.filter((r) => r.kind === "platform_total").map((r, i) => (
                    <tr key={i} className="border-t border-border/50">
                      <td className="py-1 font-medium">{r.label}</td>
                      <td className="py-1 text-right tabular-nums">{money(r.gross)}</td>
                      <td className="py-1 text-right tabular-nums">{money(r.redemption)}</td>
                      <td className={`py-1 text-right tabular-nums ${r.net < 0 ? "text-rose-600" : ""}`}>{money(r.net)}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-border font-semibold">
                    <td className="py-1">Total</td>
                    <td className="py-1 text-right tabular-nums">{money(net.total.gross)}</td>
                    <td className="py-1 text-right tabular-nums">{money(net.total.redemption)}</td>
                    <td className={`py-1 text-right tabular-nums ${net.total.net < 0 ? "text-rose-600" : ""}`}>{money(net.total.net)}</td>
                  </tr>
                </tbody>
              </table>
            ) : (
              <Empty />
            )}
          </Section>
        </div>
      )}
    </div>
  );
}

function Section({ title, href, children, wide }: { title: string; href: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`rounded-xl border border-border p-4 ${wide ? "md:col-span-2" : ""}`}>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        <Link href={href} className="text-xs text-brand-cyan-deep hover:underline inline-flex items-center gap-0.5 print:hidden">
          Open <ArrowRight className="size-3" />
        </Link>
      </div>
      {children}
    </div>
  );
}
function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-lg border border-border/60 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`font-semibold tabular-nums ${tone === "good" ? "text-emerald-600" : tone === "bad" ? "text-rose-600" : ""}`}>{value}</div>
    </div>
  );
}
function Empty() {
  return <div className="text-xs text-muted-foreground py-4 text-center">No data for this month.</div>;
}
