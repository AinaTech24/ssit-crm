/**
 * Team Performance — KRA scorecard. A per-person leaderboard for the Sales and
 * Operations teams: weighted KRA score + RAG, with each KRA's KPIs (target-free
 * V1 — count KPIs ranked vs the team best, %-KPIs on their own value). Owners /
 * branch heads only.
 */

import Link from "next/link";
import { Trophy, ArrowLeft, TrendingUp, Headphones, Target } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { withTenant } from "@/db/client";
import { loadScorecard, type MemberRow, type Kpi } from "@/lib/team/scorecard";
import { resolvePeriodDates, type Period } from "@/lib/dashboard/period";
import { PeriodSelector } from "@/components/dashboards/PeriodSelector";
import { AutoRefresh } from "@/components/common/AutoRefresh";

export const dynamic = "force-dynamic";

const inr = (n: number) =>
  n >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(2)} L` : `₹${Math.round(n).toLocaleString("en-IN")}`;
const BAND: Record<string, string> = { green: "bg-emerald-500", amber: "bg-amber-500", red: "bg-rose-500" };

function fmt(k: Kpi | undefined): string {
  if (!k) return "—";
  if (k.unit === "inr") return inr(k.actual);
  if (k.unit === "pct") return `${Math.round(k.actual)}%`;
  return String(k.actual);
}
function fmtVal(n: number, unit: Kpi["unit"]): string {
  if (unit === "inr") return inr(n);
  if (unit === "pct") return `${Math.round(n)}%`;
  return String(n);
}
const kpi = (r: MemberRow, key: string) => r.kpis.find((k) => k.key === key);

/** Plain-text summary of how a member's KRA score was built — one line per KPI
 *  with its value, 0–100 score and weight — surfaced as a hover tooltip so the
 *  red/amber/green band has an explanation. Uses data already on the row. */
function scoreBreakdown(r: MemberRow): string {
  const lines = r.kpis.map(
    (k) => `${k.label}: ${fmtVal(k.actual, k.unit)} → ${Math.round(k.score)}/100 (weight ${Math.round(k.weight * 100)}%)`
  );
  return `KRA score ${r.kraScore} (${r.band})\n${lines.join("\n")}`;
}

export default async function ScorecardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  if (!can(session.roles, "dashboard.view.owner", session.permissions)) {
    return (
      <div className="card-surface p-12 text-center max-w-lg mx-auto">
        <Trophy className="size-10 text-amber-500 mx-auto mb-3" />
        <div className="font-semibold text-lg">Managers only</div>
        <p className="text-sm text-muted-foreground mt-1">The team scorecard is for owners and branch heads.</p>
      </div>
    );
  }
  const sp = await searchParams;
  const period = (sp.period ?? "mtd") as Period;
  const pstart = sp.pstart;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const { startISO, label } = resolvePeriodDates(period, new Date(), pstart);
  const from = startISO.slice(0, 10);

  const data = await withTenant(session.tenantId, async (tx) => loadScorecard(tx as any, session.tenantId, from, today));

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Leaderboard reflects live activity — keep it current as work lands. */}
      <AutoRefresh intervalMs={60000} />
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <Link href="/dashboard/team" className="text-xs text-muted-foreground hover:underline inline-flex items-center gap-1 mb-1">
            <ArrowLeft className="size-3" /> Team
          </Link>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Trophy className="size-6 text-brand-cyan" /> Team Scorecard
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">KRA performance · {label}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Link
            href="/dashboard/team/scorecard/targets"
            className="rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium flex items-center gap-1.5 hover:bg-secondary/60"
          >
            <Target className="size-4 text-brand-cyan" /> Set targets
          </Link>
          <PeriodSelector current={period} variant="light" />
        </div>
      </div>

      <ScoreTable
        title="Sales team"
        icon="sales"
        rows={data.sales}
        cols={[
          { key: "mf_business", label: "MF" },
          { key: "insurance_business", label: "Insurance" },
          { key: "other_business", label: "Other" },
          { key: "new_clients", label: "Clients" },
          { key: "converted", label: "Converted" },
        ]}
      />
      <ScoreTable
        title="Operations team"
        icon="ops"
        rows={data.ops}
        cols={[
          { key: "sla", label: "SLA" },
          { key: "resolved", label: "Resolved" },
          { key: "overdue", label: "Overdue" },
          { key: "attendance", label: "Attendance" },
        ]}
      />

      <p className="text-[11px] text-muted-foreground">
        KRA score is a weighted blend of each KPI. Business is split by product — MF &amp; Other from business entries,
        Insurance from booked policy premium. When a per-person target is set (Set targets), that KPI scores actual vs the
        pro-rated target; otherwise count KPIs rank against the team&apos;s top performer, %-KPIs (SLA, attendance) score on
        their own value, and overdue tasks invert (fewer is better).
      </p>
    </div>
  );
}

function ScoreTable({
  title,
  icon,
  rows,
  cols,
}: {
  title: string;
  icon: "sales" | "ops";
  rows: MemberRow[];
  cols: { key: string; label: string }[];
}) {
  const Icon = icon === "sales" ? TrendingUp : Headphones;
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-bold uppercase tracking-wide flex items-center gap-1.5">
        <Icon className="size-4 text-brand-cyan" /> {title}
        <span className="text-muted-foreground font-medium normal-case">· {rows.length}</span>
      </h2>
      {rows.length === 0 ? (
        <div className="card-surface p-6 text-sm text-muted-foreground text-center">
          No active {title.toLowerCase()} members (by role).
        </div>
      ) : (
        <div className="card-surface table-scroll">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b border-border sticky top-0 z-10 bg-card">
              <tr>
                <th className="text-left font-medium px-3 py-2">#</th>
                <th className="text-left font-medium px-3 py-2">Member</th>
                <th className="text-left font-medium px-3 py-2">KRA score</th>
                {cols.map((c) => (
                  <th key={c.key} className="text-right font-medium px-3 py-2">{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r, i) => (
                <tr key={r.userId}>
                  <td className="px-3 py-2 text-muted-foreground tabular-nums">{i + 1}</td>
                  <td className="px-3 py-2 font-medium whitespace-nowrap">{r.name}</td>
                  <td className="px-3 py-2">
                    <span
                      className="inline-flex items-center gap-2 font-bold tabular-nums cursor-help"
                      title={scoreBreakdown(r)}
                    >
                      <span className={`size-2 rounded-full ${BAND[r.band]}`} /> {r.kraScore}
                    </span>
                  </td>
                  {cols.map((c) => {
                    const k = kpi(r, c.key);
                    return (
                      <td key={c.key} className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                        {fmt(k)}
                        {k?.target ? <span className="text-[10px] text-muted-foreground"> / {fmtVal(k.target, k.unit)}</span> : null}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
