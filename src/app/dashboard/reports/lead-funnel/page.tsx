/**
 * Lead Funnel & Conversion report.
 *
 * Answers the questions an MFD owner actually asks about leads:
 *   • Where do my leads come from, and which source actually CONVERTS?
 *   • Which RM converts the most — and how fast?
 *   • Where in the funnel am I losing people?
 *   • Whose follow-ups have slipped? (the silent killer)
 *
 * All figures are computed from `leads` — conversion is `converted_at`/
 * `converted_investor_id` stamped by the convert route, so "converted" here
 * means a real client was created, not just a stage label.
 */

import Link from "next/link";
import { ChevronLeft, Users, TrendingUp, AlertTriangle, Clock, CalendarClock, UserCheck } from "lucide-react";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { CollapsibleKpiStrip } from "@/components/investors/CollapsibleKpiStrip";

export const dynamic = "force-dynamic";

const WINDOWS: Record<string, { label: string; days: number | null }> = {
  "30": { label: "Last 30 days", days: 30 },
  "90": { label: "Last 90 days", days: 90 },
  "180": { label: "Last 6 months", days: 180 },
  "365": { label: "Last 12 months", days: 365 },
  all: { label: "All time", days: null },
};

/** Stages that mean the lead is closed and will never convert.
 *  Rendered as an IN (...) list — a JS array bound to `= ANY($1)` does NOT
 *  arrive as a Postgres array and fails with
 *  "op ANY/ALL (array) requires array on right side". */
const DEAD = ["lost", "not_interested", "not_qualified"];
const DEAD_LIST = sql.join(
  DEAD.map((v) => sql`${v}`),
  sql`, `
);

function pct(n: number, d: number): string {
  if (!d) return "—";
  return `${((n / d) * 100).toFixed(1)}%`;
}
function human(s: string) {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default async function LeadFunnelReport({
  searchParams,
}: {
  searchParams: Promise<{ w?: string }>;
}) {
  const sp = await searchParams;
  const session = await requireSession();
  requireCap(session.roles, "lead.view.all", session.permissions);
  await assertActiveLicense(session.tenantId, session.roles);

  const wKey = sp.w && WINDOWS[sp.w] ? sp.w : "90";
  const days = WINDOWS[wKey].days;
  const since = days
    ? sql`AND l.created_at >= now() - make_interval(days => ${days})`
    : sql``;

  const data = await withTenant(
    session.tenantId,
    async (tx) => {
      const T = session.tenantId;

      // ── Headline funnel ──
      const totals = (
        await tx.execute(sql`
          SELECT
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE l.converted_at IS NOT NULL)::int AS converted,
            COUNT(*) FILTER (WHERE l.stage IN (${DEAD_LIST}))::int AS dead,
            COUNT(*) FILTER (WHERE l.converted_at IS NULL AND NOT (l.stage IN (${DEAD_LIST})))::int AS open,
            COUNT(*) FILTER (WHERE l.next_follow_up_at IS NOT NULL AND l.next_follow_up_at < now()
                             AND l.converted_at IS NULL AND NOT (l.stage IN (${DEAD_LIST})))::int AS overdue_fu,
            COUNT(*) FILTER (WHERE l.next_follow_up_at IS NULL
                             AND l.converted_at IS NULL AND NOT (l.stage IN (${DEAD_LIST})))::int AS no_fu,
            COUNT(*) FILTER (WHERE l.next_follow_up_at::date = current_date
                             AND l.converted_at IS NULL)::int AS due_today,
            ROUND(AVG(EXTRACT(EPOCH FROM (l.converted_at - l.created_at)) / 86400)
                  FILTER (WHERE l.converted_at IS NOT NULL))::int AS avg_days_to_convert
          FROM leads l
          WHERE l.tenant_id = ${T}::uuid ${since}
        `)
      ).rows[0] as any;

      // ── By source: the "where should I spend?" answer ──
      const bySource = (
        await tx.execute(sql`
          SELECT COALESCE(l.source, 'unknown') AS source,
                 COUNT(*)::int AS leads,
                 COUNT(*) FILTER (WHERE l.converted_at IS NOT NULL)::int AS converted,
                 COUNT(*) FILTER (WHERE l.stage IN (${DEAD_LIST}))::int AS dead,
                 ROUND(AVG(EXTRACT(EPOCH FROM (l.converted_at - l.created_at)) / 86400)
                       FILTER (WHERE l.converted_at IS NOT NULL))::int AS avg_days
          FROM leads l
          WHERE l.tenant_id = ${T}::uuid ${since}
          GROUP BY COALESCE(l.source, 'unknown')
          ORDER BY converted DESC, leads DESC
        `)
      ).rows as any[];

      // ── By RM: the "who actually closes?" answer ──
      const byRm = (
        await tx.execute(sql`
          SELECT COALESCE(u.name, 'Unassigned') AS rm,
                 COUNT(*)::int AS leads,
                 COUNT(*) FILTER (WHERE l.converted_at IS NOT NULL)::int AS converted,
                 COUNT(*) FILTER (WHERE l.stage IN (${DEAD_LIST}))::int AS dead,
                 COUNT(*) FILTER (WHERE l.next_follow_up_at IS NOT NULL AND l.next_follow_up_at < now()
                                  AND l.converted_at IS NULL AND NOT (l.stage IN (${DEAD_LIST})))::int AS overdue_fu,
                 ROUND(AVG(EXTRACT(EPOCH FROM (l.converted_at - l.created_at)) / 86400)
                       FILTER (WHERE l.converted_at IS NOT NULL))::int AS avg_days
          FROM leads l
          LEFT JOIN users u ON u.id = l.owner_id
          WHERE l.tenant_id = ${T}::uuid ${since}
          GROUP BY COALESCE(u.name, 'Unassigned')
          ORDER BY converted DESC, leads DESC
        `)
      ).rows as any[];

      // ── Open pipeline by stage: where leads are sitting ──
      const byStage = (
        await tx.execute(sql`
          SELECT l.stage,
                 COUNT(*)::int AS leads,
                 COUNT(*) FILTER (WHERE l.next_follow_up_at IS NOT NULL AND l.next_follow_up_at < now())::int AS overdue_fu
          FROM leads l
          WHERE l.tenant_id = ${T}::uuid AND l.converted_at IS NULL
                AND NOT (l.stage IN (${DEAD_LIST})) ${since}
          GROUP BY l.stage
          ORDER BY leads DESC
        `)
      ).rows as any[];

      return { totals, bySource, byRm, byStage };
    },
    { userId: session.userId, branchId: session.branchId ?? undefined, roles: session.roles }
  );

  const t = data.totals;
  const total = Number(t.total ?? 0);

  return (
    <div className="space-y-5 max-w-6xl">
      <Link href="/dashboard/reports" className="text-sm text-muted-foreground hover:underline flex items-center gap-1">
        <ChevronLeft className="size-4" /> Back to reports
      </Link>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Lead Funnel &amp; Conversion</h1>
          <p className="text-muted-foreground text-sm">
            Which source is worth your money, which RM actually closes, and whose follow-ups have slipped.
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1">
          {Object.entries(WINDOWS).map(([k, v]) => (
            <Link
              key={k}
              href={`/dashboard/reports/lead-funnel?w=${k}`}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                k === wKey ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary"
              }`}
            >
              {v.label}
            </Link>
          ))}
        </div>
      </div>

      <CollapsibleKpiStrip storageKey="lead-funnel-kpi" title="Summary">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Kpi label="Leads in period" value={total.toLocaleString("en-IN")} icon={Users} />
          <Kpi label="Converted to clients" value={`${Number(t.converted ?? 0)} · ${pct(Number(t.converted ?? 0), total)}`} icon={UserCheck} tone="emerald" />
          <Kpi label="Still open" value={String(Number(t.open ?? 0))} icon={TrendingUp} />
          <Kpi label="Avg days to convert" value={t.avg_days_to_convert != null ? `${t.avg_days_to_convert}d` : "—"} icon={Clock} />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
          <Kpi label="Follow-up OVERDUE" value={String(Number(t.overdue_fu ?? 0))} icon={AlertTriangle} tone={Number(t.overdue_fu) > 0 ? "rose" : "muted"} href="/dashboard/leads?followup_overdue=1" />
          <Kpi label="No follow-up date set" value={String(Number(t.no_fu ?? 0))} icon={CalendarClock} tone={Number(t.no_fu) > 0 ? "amber" : "muted"} href="/dashboard/leads" />
          <Kpi label="Due today" value={String(Number(t.due_today ?? 0))} icon={CalendarClock} href="/dashboard/leads?followup_today=1" />
          <Kpi label="Lost / not interested" value={String(Number(t.dead ?? 0))} icon={TrendingUp} tone="muted" />
        </div>
      </CollapsibleKpiStrip>

      {/* By source */}
      <Section
        title="By source — where your clients actually come from"
        hint="Conversion % matters more than lead count. A source with 20 leads and 6 clients beats one with 200 leads and 3."
      >
        <Table
          head={["Source", "Leads", "Converted", "Conversion %", "Lost", "Avg days"]}
          rows={data.bySource.map((r) => [
            human(String(r.source)),
            String(r.leads),
            String(r.converted),
            pct(Number(r.converted), Number(r.leads)),
            String(r.dead),
            r.avg_days != null ? `${r.avg_days}d` : "—",
          ])}
          highlight={3}
          empty="No leads in this period."
        />
      </Section>

      {/* By RM */}
      <Section
        title="By RM — who converts, and who is sitting on overdue follow-ups"
        hint="Read the last two columns together: a high conversion % with zero overdue follow-ups is the pattern to copy across the team."
      >
        <Table
          head={["RM", "Leads", "Converted", "Conversion %", "Lost", "Overdue follow-ups", "Avg days"]}
          rows={data.byRm.map((r) => [
            String(r.rm),
            String(r.leads),
            String(r.converted),
            pct(Number(r.converted), Number(r.leads)),
            String(r.dead),
            String(r.overdue_fu),
            r.avg_days != null ? `${r.avg_days}d` : "—",
          ])}
          highlight={3}
          warnCol={5}
          empty="No leads in this period."
        />
      </Section>

      {/* Open pipeline by stage */}
      <Section
        title="Open pipeline by stage — where leads are stuck"
        hint="A big pile in one stage is a process problem, not a people problem."
      >
        <Table
          head={["Stage", "Open leads", "Of which overdue follow-up"]}
          rows={data.byStage.map((r) => [human(String(r.stage)), String(r.leads), String(r.overdue_fu)])}
          warnCol={2}
          empty="No open leads."
        />
      </Section>

      <p className="text-[11px] text-muted-foreground">
        &ldquo;Converted&rdquo; counts leads where a client record was actually created (not just a stage rename).
        Avg days = time from lead created to client created.
      </p>
    </div>
  );
}

function Kpi({
  label, value, icon: Icon, tone, href,
}: { label: string; value: string; icon: any; tone?: "emerald" | "rose" | "amber" | "muted"; href?: string }) {
  const color =
    tone === "emerald" ? "text-emerald-600" : tone === "rose" ? "text-rose-600" : tone === "amber" ? "text-amber-600" : "text-foreground";
  const inner = (
    <div className="card-surface glass-card p-4 h-full">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">{label}</span>
        <Icon className="size-4 text-muted-foreground" />
      </div>
      <div className={`text-xl font-bold mt-2 tabular-nums tracking-tight ${color}`}>{value}</div>
    </div>
  );
  return href ? <Link href={href} className="block hover:opacity-90 transition-opacity">{inner}</Link> : inner;
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="border rounded-lg bg-card p-5">
      <h2 className="font-semibold">{title}</h2>
      {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
      <div className="mt-3">{children}</div>
    </div>
  );
}

function Table({
  head, rows, highlight, warnCol, empty,
}: { head: string[]; rows: string[][]; highlight?: number; warnCol?: number; empty: string }) {
  if (rows.length === 0) return <div className="text-sm text-muted-foreground py-6 text-center">{empty}</div>;
  return (
    <div className="max-h-96 overflow-auto scrollbar-none rounded-lg border">
      <table className="w-full text-sm border-collapse min-w-[560px]">
        <thead className="sticky top-0 bg-muted/60 backdrop-blur">
          <tr className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {head.map((h, i) => (
              <th key={h} className={`py-2.5 px-3 font-medium ${i === 0 ? "text-left" : "text-right"} whitespace-nowrap`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} className="border-t hover:bg-muted/30">
              {r.map((c, ci) => {
                const warn = warnCol === ci && Number(c) > 0;
                return (
                  <td
                    key={ci}
                    className={`py-2.5 px-3 whitespace-nowrap ${ci === 0 ? "text-left font-medium" : "text-right tabular-nums"} ${
                      highlight === ci ? "font-semibold text-emerald-700" : ""
                    } ${warn ? "font-semibold text-rose-600" : ""}`}
                  >
                    {c}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
