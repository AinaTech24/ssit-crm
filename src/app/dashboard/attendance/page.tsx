import Link from "next/link";
import { sql } from "drizzle-orm";
import { CalendarCheck, CheckCircle2, XCircle, CalendarOff, Grid3x3, CalendarDays, Settings, ClipboardCheck, ChevronLeft, ChevronRight } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { dateRangeCond } from "@/lib/filters/date-range";
import { ClockWidget } from "@/components/attendance/ClockWidget";
import { AttendanceTable } from "@/components/attendance/AttendanceTable";
import { AttendanceToolbar } from "@/components/attendance/AttendanceToolbar";
import { ATTENDANCE_STATUS_LABELS, computeAttendanceFlags } from "@/lib/attendance/policy";
import { loadAttendancePolicy } from "@/lib/attendance/settings";

const PAGE_SIZE = 50;

export const dynamic = "force-dynamic";

export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const statusFilter = (sp.status ?? "").split(",").filter(Boolean);
  const todayOnly = sp.today === "1";
  const canManage = session.roles.some((r) => ["owner", "branch_head"].includes(r));
  const page = Math.max(1, Number(sp.page) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const data = await withTenant(session.tenantId, async (tx) => {
    const policy = await loadAttendancePolicy(tx, session.tenantId);
    const conds: any[] = [sql`a.tenant_id = ${session.tenantId}::uuid`];
    if (q) conds.push(sql`u.name ILIKE ${`%${q}%`}`);
    if (statusFilter.length) conds.push(sql`a.status IN (${sql.join(statusFilter.map((v) => sql`${v}`), sql`, `)})`);
    const dr = dateRangeCond(sp, "date", "a.attendance_date");
    if (todayOnly) conds.push(sql`a.attendance_date = current_date`);
    else if (dr) conds.push(dr);
    else conds.push(sql`a.attendance_date >= current_date - interval '30 days'`);
    const whereSql = sql`WHERE ${sql.join(conds, sql` AND `)}`;

    const totalRow = await tx.execute(sql`
      SELECT COUNT(*)::int AS total
      FROM attendance a LEFT JOIN users u ON u.id = a.employee_user_id
      ${whereSql}
    `);
    const total = Number((totalRow.rows[0] as any)?.total ?? 0);

    const rowsRes = await tx.execute(sql`
      SELECT a.id, a.employee_user_id, a.attendance_date, a.status, a.clock_in_at, a.clock_out_at,
             a.total_minutes, a.note, a.source, u.name AS employee_name, u.avatar_url AS employee_avatar_url
      FROM attendance a LEFT JOIN users u ON u.id = a.employee_user_id
      ${whereSql}
      ORDER BY a.attendance_date DESC, u.name ASC
      LIMIT ${PAGE_SIZE} OFFSET ${offset}
    `);
    // Flag late-in / early-out per row from the tenant's work-hours policy.
    const rows = (rowsRes.rows as any[]).map((r) => {
      const f = computeAttendanceFlags(String(r.attendance_date), r.clock_in_at, r.clock_out_at, policy);
      return {
        ...r,
        is_late: f.isLate,
        late_minutes: f.lateMinutes,
        is_early_out: f.isEarlyOut,
        early_minutes: f.earlyMinutes,
      };
    });

    const stats = await tx.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE attendance_date = current_date AND status = 'present')::int AS present_today,
        COUNT(*) FILTER (WHERE attendance_date = current_date AND status = 'absent')::int AS absent_today,
        COUNT(*) FILTER (WHERE attendance_date = current_date AND status = 'on_leave')::int AS on_leave_today,
        (SELECT COUNT(*)::int FROM users WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active') AS active_employees
      FROM attendance WHERE tenant_id = ${session.tenantId}::uuid
    `);

    const myToday = await tx.execute(sql`
      SELECT clock_in_at, clock_out_at, total_minutes, status FROM attendance
      WHERE tenant_id = ${session.tenantId}::uuid AND employee_user_id = ${session.userId}::uuid AND attendance_date = current_date
      LIMIT 1
    `);

    return { rows, total, stats: stats.rows[0] as any, myToday: (myToday.rows[0] as any) ?? null };
  });

  const s = data.stats;
  const pageCount = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  const pageHref = (p: number) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (v && k !== "page") params.set(k, v);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `/dashboard/attendance?${qs}` : "/dashboard/attendance";
  };

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <CalendarCheck className="size-6 text-brand-cyan" /> Attendance
          </h1>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <Link href="/dashboard/attendance/regularizations" className="btn-secondary text-xs">
            <ClipboardCheck className="size-3.5" /> Corrections
          </Link>
          <Link href="/dashboard/attendance/holidays" className="btn-secondary text-xs">
            <CalendarDays className="size-3.5" /> Holidays
          </Link>
          {canManage && (
            <Link href="/dashboard/attendance/settings" className="btn-secondary text-xs">
              <Settings className="size-3.5" /> Settings
            </Link>
          )}
          <Link href="/dashboard/attendance/grid" className="btn-secondary text-xs">
            <Grid3x3 className="size-3.5" /> Monthly grid
          </Link>
        </div>
      </div>

      <ClockWidget today={data.myToday} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat icon={CheckCircle2} label="Present today" value={`${s.present_today ?? 0} / ${s.active_employees ?? 0}`} tone="emerald" />
        <Stat icon={XCircle} label="Absent today" value={s.absent_today ?? 0} tone={s.absent_today > 0 ? "rose" : "muted"} />
        <Stat icon={CalendarOff} label="On leave today" value={s.on_leave_today ?? 0} tone={s.on_leave_today > 0 ? "amber" : "muted"} />
        <Stat icon={CalendarCheck} label="Active employees" value={s.active_employees ?? 0} />
      </div>

      <AttendanceTable
        rows={data.rows}
        canManage={canManage}
        toolbar={
          <AttendanceToolbar
            statusOptions={Object.entries(ATTENDANCE_STATUS_LABELS).map(([value, label]) => ({ value, label }))}
          />
        }
      />

      {pageCount > 1 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Page {page} of {pageCount} · {data.total} record{data.total === 1 ? "" : "s"}
          </span>
          <div className="flex items-center gap-1.5">
            {page > 1 ? (
              <Link href={pageHref(page - 1)} className="btn-secondary text-xs"><ChevronLeft className="size-3.5" /> Prev</Link>
            ) : (
              <span className="btn-secondary text-xs opacity-40 pointer-events-none"><ChevronLeft className="size-3.5" /> Prev</span>
            )}
            {page < pageCount ? (
              <Link href={pageHref(page + 1)} className="btn-secondary text-xs">Next <ChevronRight className="size-3.5" /></Link>
            ) : (
              <span className="btn-secondary text-xs opacity-40 pointer-events-none">Next <ChevronRight className="size-3.5" /></span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ icon: Icon, label, value, tone }: { icon: any; label: string; value: number | string; tone?: "rose" | "amber" | "emerald" | "muted" }) {
  const color = tone === "rose" ? "text-rose-600" : tone === "amber" ? "text-amber-600" : tone === "emerald" ? "text-emerald-600" : "text-foreground";
  return (
    <div className="card-surface p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        <Icon className="size-3.5 text-muted-foreground" />
      </div>
      <div className={`text-2xl font-bold mt-1 tabular-nums ${color}`}>{value}</div>
    </div>
  );
}
