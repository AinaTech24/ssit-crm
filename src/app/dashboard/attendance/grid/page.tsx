import Link from "next/link";
import { sql } from "drizzle-orm";
import { ChevronLeft, ChevronRight, Grid3x3, Download } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { ATTENDANCE_STATUS_SHORT, ATTENDANCE_STATUS_TONE, ATTENDANCE_STATUS_LABELS } from "@/lib/attendance/policy";
import { DownloadButton } from "@/components/common/SecureLinkButtons";

export const dynamic = "force-dynamic";

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default async function AttendanceGridPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  const now = new Date();
  const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const month = sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : current;
  const [y, m] = month.split("-").map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const monthStart = `${month}-01`;
  const monthEnd = `${shiftMonth(month, 1)}-01`;
  const label = new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });

  const { employees, cells } = await withTenant(session.tenantId, async (tx) => {
    const emp = await tx.execute(sql`
      SELECT id, name FROM users WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active' ORDER BY name
    `);
    const att = await tx.execute(sql`
      SELECT employee_user_id, EXTRACT(DAY FROM attendance_date)::int AS day, status
      FROM attendance
      WHERE tenant_id = ${session.tenantId}::uuid
        AND attendance_date >= ${monthStart}::date AND attendance_date < ${monthEnd}::date
    `);
    return { employees: emp.rows as any[], cells: att.rows as any[] };
  });

  // grid[employeeId][day] = status
  const grid: Record<string, Record<number, string>> = {};
  for (const c of cells) {
    (grid[c.employee_user_id] ??= {})[Number(c.day)] = c.status;
  }
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const todayDay = month === current ? now.getDate() : -1;
  const isManager = can(session.roles, "attendance.manage.all", session.permissions);

  function totals(eid: string) {
    const row = grid[eid] ?? {};
    let p = 0, l = 0, a = 0;
    for (const d of Object.values(row)) {
      if (d === "present" || d === "half_day") p++;
      else if (d === "on_leave") l++;
      else if (d === "absent") a++;
    }
    return { p, l, a };
  }

  return (
    <div className="space-y-5 max-w-[1400px]">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <Link href="/dashboard/attendance" className="text-sm text-muted-foreground hover:underline flex items-center gap-1">
            <ChevronLeft className="size-4" /> Back to attendance
          </Link>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2 mt-1">
            <Grid3x3 className="size-6 text-brand-cyan" /> Monthly attendance
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <Link href={`/dashboard/attendance/grid?month=${shiftMonth(month, -1)}`} className="btn-ghost text-sm inline-flex items-center gap-1"><ChevronLeft className="size-4" /> {shiftMonth(month, -1)}</Link>
          <span className="font-bold tabular-nums">{label}</span>
          <Link href={`/dashboard/attendance/grid?month=${shiftMonth(month, 1)}`} className="btn-ghost text-sm inline-flex items-center gap-1">{shiftMonth(month, 1)} <ChevronRight className="size-4" /></Link>
          {isManager && (
            <DownloadButton url={`/api/attendance/export?month=${month}`} className="btn-ghost text-sm inline-flex items-center gap-1"><Download className="size-4" /> Export CSV</DownloadButton>
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-2 text-[11px]">
        {Object.entries(ATTENDANCE_STATUS_LABELS).map(([k, l]) => (
          <span key={k} className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 ${ATTENDANCE_STATUS_TONE[k]}`}>
            <b>{ATTENDANCE_STATUS_SHORT[k]}</b> {l}
          </span>
        ))}
      </div>

      {employees.length === 0 ? (
        <div className="card-surface p-12 text-center text-sm text-muted-foreground">No active employees.</div>
      ) : (
        <div className="card-surface overflow-x-auto">
          <table className="text-xs border-collapse">
            <thead>
              <tr className="border-b">
                <th className="sticky left-0 bg-card text-left px-3 py-2 font-medium min-w-[140px] z-10">Employee</th>
                {days.map((d) => (
                  <th key={d} className={`px-1 py-2 font-medium text-center w-7 ${d === todayDay ? "bg-brand-cyan-light text-brand-cyan-deep" : "text-muted-foreground"}`}>{d}</th>
                ))}
                <th className="px-2 py-2 font-medium text-center">P</th>
                <th className="px-2 py-2 font-medium text-center">L</th>
                <th className="px-2 py-2 font-medium text-center">A</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((e) => {
                const t = totals(e.id);
                return (
                  <tr key={e.id} className="border-b last:border-0 hover:bg-secondary/30">
                    <td className="sticky left-0 bg-card px-3 py-1.5 font-medium whitespace-nowrap z-10">{e.name}</td>
                    {days.map((d) => {
                      const st = grid[e.id]?.[d];
                      return (
                        <td key={d} className="px-0.5 py-1.5 text-center">
                          {st ? (
                            <span className={`inline-block w-6 rounded text-[10px] font-bold ${ATTENDANCE_STATUS_TONE[st] ?? ""}`} title={ATTENDANCE_STATUS_LABELS[st]}>
                              {ATTENDANCE_STATUS_SHORT[st]}
                            </span>
                          ) : (
                            <span className="text-slate-300">·</span>
                          )}
                        </td>
                      );
                    })}
                    <td className="px-2 py-1.5 text-center font-bold text-emerald-700">{t.p}</td>
                    <td className="px-2 py-1.5 text-center font-bold text-blue-700">{t.l}</td>
                    <td className="px-2 py-1.5 text-center font-bold text-rose-700">{t.a}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
