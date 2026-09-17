import Link from "next/link";
import { sql } from "drizzle-orm";
import { ArrowLeft, CalendarDays, Grid3x3 } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import {
  ATTENDANCE_STATUS_LABELS,
  ATTENDANCE_STATUS_TONE,
  ATTENDANCE_STATUS_SHORT,
} from "@/lib/attendance/policy";
import { AttendanceEmployeeSelect } from "@/components/attendance/AttendanceEmployeeSelect";

export const dynamic = "force-dynamic";

/**
 * Attendance month calendar — one employee's month laid out on a date grid,
 * the way the meetings and tasks calendars lay out their feeds.
 *
 * Deliberately NOT InteractiveCalendar: that component's item model is a list
 * of dated events with a fixed `kind` union, whereas attendance is exactly one
 * *state* per day (present / absent / leave / holiday / week-off). Rendering it
 * as events would lose the "every day has a status" property that makes the
 * month readable at a glance, so this is its own (much smaller) grid.
 *
 * The existing /dashboard/attendance/grid stays: that is the whole TEAM across
 * a month (one row per employee); this is one PERSON across a month with real
 * weekday alignment, holiday names and clock times.
 */

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** One attendance day. Shapes the raw `tx.execute` result. */
type DayRow = {
  attendance_date: string;
  status: string;
  clock_in_at: string | null;
  clock_out_at: string | null;
  total_minutes: number | null;
  note: string | null;
};

type HolidayRow = { holiday_date: string; name: string };
type EmployeeRow = { id: string; name: string | null };

function hhmm(v: string | null | undefined): string | null {
  if (!v) return null;
  return new Date(v).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

export default async function AttendanceCalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const current = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
  const month = sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : current;
  const [y, m] = month.split("-").map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const monthStart = `${month}-01`;
  const monthEnd = `${shiftMonth(month, 1)}-01`;
  const monthLabel = new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });

  // Only managers may look at another employee's month; everyone else is pinned
  // to their own row regardless of what ?employee= says.
  const isManager = can(session.roles, "attendance.manage.all", session.permissions);
  const requested = sp.employee && /^[0-9a-f-]{36}$/i.test(sp.employee) ? sp.employee : null;
  const employeeId = isManager && requested ? requested : session.userId;

  const data = await withTenant(session.tenantId, async (tx) => {
    const rows = await tx.execute(sql`
      SELECT attendance_date, status, clock_in_at, clock_out_at, total_minutes, note
      FROM attendance
      WHERE tenant_id = ${session.tenantId}::uuid
        AND employee_user_id = ${employeeId}::uuid
        AND attendance_date >= ${monthStart}::date AND attendance_date < ${monthEnd}::date
    `);
    const hol = await tx.execute(sql`
      SELECT holiday_date, name FROM holidays
      WHERE tenant_id = ${session.tenantId}::uuid
        AND holiday_date >= ${monthStart}::date AND holiday_date < ${monthEnd}::date
    `);
    const emp = isManager
      ? await tx.execute(sql`
          SELECT id, name FROM users
          WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active'
          ORDER BY name
        `)
      : { rows: [] };
    const whoRes = await tx.execute(sql`
      SELECT name FROM users
      WHERE tenant_id = ${session.tenantId}::uuid AND id = ${employeeId}::uuid
      LIMIT 1
    `);
    return {
      rows: rows.rows as unknown as DayRow[],
      holidays: hol.rows as unknown as HolidayRow[],
      employees: emp.rows as unknown as EmployeeRow[],
      who: (whoRes.rows[0] as { name?: string } | undefined) ?? null,
    };
  });

  // byDay[1..31] — the attendance row and the holiday name for that date.
  const byDay: Record<number, DayRow> = {};
  for (const r of data.rows) byDay[Number(String(r.attendance_date).slice(8, 10))] = r;
  const holidayByDay: Record<number, string> = {};
  for (const h of data.holidays) holidayByDay[Number(String(h.holiday_date).slice(8, 10))] = h.name;

  // Monday-first leading blanks: getDay() is 0=Sun, so a month starting on a
  // Sunday needs six blanks, not none.
  const firstDow = new Date(y, m - 1, 1).getDay();
  const lead = (firstDow + 6) % 7;
  const cells: (number | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const totals: Record<string, number> = {
    present: 0,
    absent: 0,
    half_day: 0,
    week_off: 0,
    holiday: 0,
    on_leave: 0,
  };
  for (const r of data.rows) if (r.status in totals) totals[r.status] += 1;

  const todayDay = month === current ? now.getDate() : -1;
  const monthHref = (mo: string) => {
    const params = new URLSearchParams({ month: mo });
    if (employeeId !== session.userId) params.set("employee", employeeId);
    return `/dashboard/attendance/calendar?${params.toString()}`;
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <Link
        href="/dashboard/attendance"
        className="text-sm text-muted-foreground hover:underline hover:text-foreground inline-flex items-center gap-1 transition-colors"
      >
        <ArrowLeft className="size-4" /> Back to attendance
      </Link>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <CalendarDays className="size-6 text-brand-cyan" /> Attendance calendar
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {data.who?.name ?? "You"} · {monthLabel} · {totals.present + totals.half_day} present ·{" "}
            {totals.on_leave} on leave · {totals.absent} absent
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {isManager && data.employees.length > 0 && (
            <AttendanceEmployeeSelect
              value={employeeId}
              month={month}
              selfId={session.userId}
              options={data.employees.map((e) => ({ value: String(e.id), label: e.name ?? "—" }))}
            />
          )}
          <Link href={monthHref(shiftMonth(month, -1))} className="rounded-md border px-2.5 py-1.5 text-sm hover:bg-accent">
            ← {new Date(y, m - 2, 1).toLocaleDateString("en-IN", { month: "short" })}
          </Link>
          <div className="text-sm font-medium min-w-[140px] text-center">{monthLabel}</div>
          <Link href={monthHref(shiftMonth(month, 1))} className="rounded-md border px-2.5 py-1.5 text-sm hover:bg-accent">
            {new Date(y, m, 1).toLocaleDateString("en-IN", { month: "short" })} →
          </Link>
          <Link href="/dashboard/attendance/grid" className="btn-secondary text-xs">
            <Grid3x3 className="size-3.5" /> Monthly grid
          </Link>
        </div>
      </div>

      <div className="card-surface p-4">
        <div className="grid grid-cols-7 gap-1.5 mb-1.5">
          {WEEKDAYS.map((d) => (
            <div key={d} className="text-[11px] font-semibold text-muted-foreground text-center py-1">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1.5">
          {cells.map((day, i) => {
            if (day === null) return <div key={`blank-${i}`} className="min-h-[86px] rounded-lg bg-muted/20" />;
            const row = byDay[day];
            const holiday = holidayByDay[day];
            // No attendance row on a holiday still reads as a holiday — the
            // auto-seed may not have run for a future/just-added date.
            const status: string | undefined = row?.status ?? (holiday ? "holiday" : undefined);
            const tone = status ? ATTENDANCE_STATUS_TONE[status] : "";
            const inAt = hhmm(row?.clock_in_at);
            const outAt = hhmm(row?.clock_out_at);
            return (
              <div
                key={day}
                className={`min-h-[86px] rounded-lg border p-1.5 flex flex-col gap-1 ${
                  day === todayDay ? "ring-2 ring-brand-cyan" : ""
                }`}
                title={row?.note ?? undefined}
              >
                <div className="flex items-center justify-between">
                  <span className={`text-xs font-semibold ${day === todayDay ? "text-brand-cyan-deep" : ""}`}>
                    {day}
                  </span>
                  {status && (
                    <span
                      className={`text-[10px] font-bold rounded px-1 ${tone}`}
                      title={ATTENDANCE_STATUS_LABELS[status] ?? status}
                    >
                      {ATTENDANCE_STATUS_SHORT[status] ?? "?"}
                    </span>
                  )}
                </div>
                {status && (
                  <span className={`text-[10px] rounded px-1 py-0.5 self-start ${tone}`}>
                    {ATTENDANCE_STATUS_LABELS[status] ?? status}
                  </span>
                )}
                {holiday && (
                  <span className="text-[10px] text-violet-700 dark:text-violet-300 leading-tight line-clamp-2">
                    {holiday}
                  </span>
                )}
                {(inAt || outAt) && (
                  <span className="text-[10px] text-muted-foreground tabular-nums mt-auto">
                    {inAt ?? "—"} → {outAt ?? "—"}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2 mt-4 pt-3 border-t">
          {Object.entries(ATTENDANCE_STATUS_LABELS).map(([k, label]) => (
            <span key={k} className={`text-[11px] rounded px-1.5 py-0.5 ${ATTENDANCE_STATUS_TONE[k]}`}>
              {label} · {totals[k] ?? 0}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
