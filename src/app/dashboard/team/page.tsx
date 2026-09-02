/**
 * Team Dashboard — the manager's command view (owner / branch head).
 *
 * Adopts the "Open / Periodic / Result" framing: pending workload now,
 * today's activity, and outcomes over a date range — every money-weighted
 * bucket shows ₹, every tile deep-links to the filtered list, and a per-RM
 * table answers "who owns the overdues / pipeline / results".
 *
 * Complements the Command Center (personal "what do I do today") with the
 * team/accountability lens.
 */

import Link from "next/link";
import { sql } from "drizzle-orm";
import { Users2, Inbox, CalendarDays, Trophy, ArrowRight, CalendarOff } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { withTenant } from "@/db/client";
import { getTeamDashboard, type Metric } from "@/lib/team/dashboard";
import { LEAVE_TYPE_LABELS } from "@/lib/leave/policy";
import { TeamMemberFilter } from "@/components/dashboards/TeamMemberFilter";
import { TeamRangePicker } from "@/components/dashboards/TeamRangePicker";
import { AutoRefresh } from "@/components/common/AutoRefresh";

export const dynamic = "force-dynamic";

const TONE: Record<string, string> = {
  rose: "border-l-rose-500",
  amber: "border-l-amber-500",
  emerald: "border-l-emerald-500",
  violet: "border-l-violet-500",
  sky: "border-l-sky-500",
};

function inrCompact(n: number): string {
  if (!n || n <= 0) return "₹0";
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`;
  if (n >= 1e3) return `₹${(n / 1e3).toFixed(1)}K`;
  return `₹${Math.round(n)}`;
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default async function TeamDashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  const allowed = can(session.roles, "dashboard.view.owner", (session as any).permissions);
  if (!allowed) {
    return (
      <div className="max-w-2xl card-surface p-8 text-center text-sm text-muted-foreground">
        The Team Dashboard is for owners and branch heads. Your daily worklist is the{" "}
        <Link href="/dashboard/command-center" className="text-brand-cyan-deep hover:underline">Command Center</Link>.
      </div>
    );
  }

  const sp = await searchParams;
  const member = (sp.member ?? "").trim();
  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const from = sp.from ? new Date(sp.from) : firstOfMonth;
  const to = sp.to ? new Date(sp.to) : now;
  const toEnd = new Date(to);
  toEnd.setDate(toEnd.getDate() + 1); // exclusive upper bound

  const data = await withTenant(
    session.tenantId,
    async (tx) =>
      getTeamDashboard(tx as any, {
        fromISO: from.toISOString(),
        toEndISO: toEnd.toISOString(),
        rangeLabel: { from: ymd(from), to: ymd(to) },
        memberId: member || undefined,
      }),
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );

  // On-leave coverage + present-today count.
  const coverage = await withTenant(
    session.tenantId,
    async (tx) => {
      const r = await tx.execute(sql`
        SELECT la.id, la.leave_type, la.from_date, la.to_date, u.name AS employee_name,
               (current_date BETWEEN la.from_date AND la.to_date) AS is_today
        FROM leave_applications la
        LEFT JOIN users u ON u.id = la.employee_user_id
        WHERE la.tenant_id = ${session.tenantId}::uuid AND la.status = 'approved'
          AND la.to_date >= current_date AND la.from_date <= current_date + interval '7 days'
        ORDER BY (current_date BETWEEN la.from_date AND la.to_date) DESC, la.from_date ASC
        LIMIT 20
      `);
      const att = await tx.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE attendance_date = current_date AND status = 'present')::int AS present_today,
          (SELECT COUNT(*)::int FROM users WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active') AS active_employees
        FROM attendance WHERE tenant_id = ${session.tenantId}::uuid
      `);
      // Roster for the member-scope dropdown.
      const roster = await tx.execute(sql`
        SELECT id, name FROM users
        WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active'
        ORDER BY name ASC
      `);
      return {
        rows: r.rows as any[],
        att: att.rows[0] as any,
        members: (roster.rows as { id: string; name: string }[]).map((m) => ({
          id: String(m.id),
          name: m.name ?? "—",
        })),
      };
    },
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );
  const onLeave = coverage.rows;
  const members = coverage.members;
  const selectedMember = member ? members.find((m) => m.id === member) : undefined;

  // Range presets
  const fy = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1; // India FY starts Apr
  const last30 = new Date(now); last30.setDate(last30.getDate() - 30);
  const presets = [
    { label: "This month", from: ymd(firstOfMonth), to: ymd(now) },
    { label: "Last 30 days", from: ymd(last30), to: ymd(now) },
    { label: "This FY", from: `${fy}-04-01`, to: ymd(now) },
  ];

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Keep team workload/accountability fresh as actions complete elsewhere. */}
      <AutoRefresh intervalMs={60000} />
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Users2 className="size-6 text-brand-cyan" /> Team Dashboard
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {selectedMember
              ? `Open workload, today's activity, and results — scoped to ${selectedMember.name}.`
              : "Open workload, today's activity, and results — firm-wide, with who's accountable."}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <Link
            href="/dashboard/team/scorecard"
            className="rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium flex items-center gap-1.5 hover:bg-secondary/60"
          >
            <Trophy className="size-4 text-brand-cyan" /> Scorecard
          </Link>
          <TeamMemberFilter
            members={members}
            selected={selectedMember ? member : ""}
            from={data.range.from}
            to={data.range.to}
          />
          <div className="inline-flex flex-wrap rounded-lg border border-border bg-secondary/40 p-0.5 gap-0.5">
            {presets.map((pr) => {
              const active = data.range.from === pr.from && data.range.to === pr.to;
              return (
                <Link
                  key={pr.label}
                  href={`/dashboard/team?from=${pr.from}&to=${pr.to}${member ? `&member=${member}` : ""}`}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                    active ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {pr.label}
                </Link>
              );
            })}
          </div>
          <TeamRangePicker from={data.range.from} to={data.range.to} member={member} />
        </div>
      </div>

      {/* On-leave coverage */}
      <div className="card-surface p-4">
        <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
          <h2 className="font-semibold text-sm flex items-center gap-2 flex-wrap">
            <CalendarOff className="size-4 text-brand-cyan" /> Team availability
            <span className="text-xs font-normal text-muted-foreground">· Present today {coverage.att?.present_today ?? 0}/{coverage.att?.active_employees ?? 0}</span>
          </h2>
          <div className="flex items-center gap-3 text-xs flex-wrap">
            <Link href="/dashboard/attendance" className="text-brand-cyan hover:underline">Attendance →</Link>
            <Link href="/dashboard/leave-applications" className="text-brand-cyan hover:underline">Leave board →</Link>
          </div>
        </div>
        {onLeave.length === 0 ? (
          <p className="text-sm text-emerald-700">Full team available — no approved leave today or this week. ✓</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {onLeave.map((l: any) => (
              <span
                key={l.id}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${
                  l.is_today ? "border-rose-200 bg-rose-50 text-rose-700" : "border-amber-200 bg-amber-50 text-amber-700"
                }`}
                title={`${LEAVE_TYPE_LABELS[l.leave_type] ?? l.leave_type} · ${l.from_date}${l.to_date !== l.from_date ? `–${l.to_date}` : ""}`}
              >
                <span className={`size-1.5 rounded-full ${l.is_today ? "bg-rose-500" : "bg-amber-500"}`} />
                {l.employee_name ?? "Employee"}
                <span className="opacity-70">{l.is_today ? "· today" : `· from ${new Date(l.from_date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-5 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
        <Column title="Open" sub="Pending right now" icon={Inbox} metrics={data.open} />
        <Column title="Periodic" sub={`Today · ${data.range.to}`} icon={CalendarDays} metrics={data.periodic} />
        <Column title="Result" sub={`${data.range.from} → ${data.range.to}`} icon={Trophy} metrics={data.result} />
      </div>

      {/* Per-RM accountability */}
      <div className="card-surface overflow-hidden">
        <div className="px-4 py-3 border-b bg-secondary/30">
          <h2 className="font-semibold text-sm flex items-center gap-2">
            <Users2 className="size-4" /> Per-RM accountability
          </h2>
        </div>
        {data.perRm.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No RM workload to show.</div>
        ) : (
          <div className="table-scroll">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b sticky top-0 z-10 bg-card">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">RM</th>
                  <th className="text-right py-2 font-medium">Overdue tasks</th>
                  <th className="text-right py-2 font-medium">Due today</th>
                  <th className="text-right py-2 font-medium">Open leads</th>
                  <th className="text-right py-2 font-medium">Pipeline ₹</th>
                  <th className="text-right py-2 font-medium">Tasks done</th>
                  <th className="text-right py-2 font-medium pr-4">Converted (₹)</th>
                </tr>
              </thead>
              <tbody>
                {data.perRm.map((r) => (
                  <tr key={r.id} className="border-b last:border-0 hover:bg-accent/40">
                    <td className="px-4 py-2.5 font-medium">
                      <Link
                        href={`/dashboard?rm=${r.id}&date_from=${data.range.from}&date_to=${data.range.to}`}
                        className="hover:text-brand-cyan-deep hover:underline"
                      >
                        {r.name}
                      </Link>
                    </td>
                    <td className={`py-2.5 text-right tabular-nums ${r.overdueTasks > 0 ? "text-rose-600 font-semibold" : "text-muted-foreground"}`}>{r.overdueTasks}</td>
                    <td className="py-2.5 text-right tabular-nums text-muted-foreground">{r.dueTodayTasks}</td>
                    <td className="py-2.5 text-right tabular-nums">{r.openLeads}</td>
                    <td className="py-2.5 text-right tabular-nums text-violet-700">{inrCompact(r.openLeadsAmt)}</td>
                    <td className="py-2.5 text-right tabular-nums">{r.completedTasks}</td>
                    <td className="py-2.5 text-right tabular-nums pr-4 text-emerald-700">
                      {r.convertedLeads} <span className="text-[11px] text-muted-foreground">/ {inrCompact(r.convertedAmt)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Column({
  title, sub, icon: Icon, metrics,
}: {
  title: string;
  sub: string;
  icon: any;
  metrics: Metric[];
}) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-baseline gap-2 px-0.5">
        <h2 className="text-sm font-bold uppercase tracking-wide flex items-center gap-1.5">
          <Icon className="size-4" /> {title}
        </h2>
        <span className="text-[11px] text-muted-foreground">{sub}</span>
      </div>
      <div className="space-y-2">
        {metrics.map((m) => (
          <Link
            key={m.key}
            href={m.href}
            className={`card-surface border-l-4 ${TONE[m.tone ?? "sky"]} px-4 py-2.5 flex items-center justify-between hover:bg-accent/40 transition-colors`}
          >
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">{m.label}</div>
              {m.amount != null && m.amount > 0 && (
                <div className="text-[11px] text-muted-foreground">{inrCompact(m.amount)}</div>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xl font-bold tabular-nums">{m.count}</span>
              <ArrowRight className="size-3.5 text-muted-foreground" />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
