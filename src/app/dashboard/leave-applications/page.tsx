import Link from "next/link";
import { sql } from "drizzle-orm";
import { Plus, CalendarOff, Clock, CheckCircle2, CalendarDays, SlidersHorizontal, FileUp } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { CompactFilterBar } from "@/components/common/CompactFilterBar";
import { CustomViews } from "@/components/common/CustomViews";
import { LeaveTable } from "@/components/leave/LeaveTable";
import { resolveLeaveScope, leaveScopeSql, decideLeaveCheck } from "@/lib/leave/access";
import { LeaveTimeline } from "@/components/leave/LeaveTimeline";

export const dynamic = "force-dynamic";

export default async function LeaveApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const statusFilter = (sp.status ?? "").split(",").filter(Boolean);
  const mine = sp.mine === "1";
  const view = sp.view ?? "list";

  const now = new Date();
  const year = sp.year ? parseInt(sp.year) : now.getFullYear();
  const month = sp.month ? parseInt(sp.month) : (now.getMonth() + 1);

  // Firm-wide leave administration — gates the Leave policy settings link.
  // Deciding individual requests is a PER-ROW right (see data.rows.canDecide),
  // because a branch head may act on their desk without administering the firm.
  const canApprove = can(session.roles, "leave.manage.all", session.permissions);

  const data = await withTenant(session.tenantId, async (tx) => {
    // NB: the `custom_leave_entitlements` column is part of the users schema
    // (created at migration time). Do NOT run DDL here — the app connects as a
    // non-superuser role that can't ALTER tables, which would crash the page.

    // Always load stats
    const stats = await tx.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'requested')::int AS pending,
        COUNT(*) FILTER (WHERE status = 'approved' AND current_date BETWEEN from_date AND to_date)::int AS on_leave_today,
        COUNT(*) FILTER (WHERE status = 'approved' AND from_date > current_date)::int AS upcoming,
        COUNT(*) FILTER (WHERE status = 'approved' AND decided_at >= date_trunc('month', now()))::int AS approved_mtd
      FROM leave_applications
      WHERE tenant_id = ${session.tenantId}::uuid
    `);

    if (view === "timeline") {
      const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
      const endDate = `${year}-${String(month).padStart(2, "0")}-${new Date(year, month, 0).getDate()}`;

      const usersRows = await tx.execute(sql`
        SELECT id, name, department, status, email
        FROM users
        WHERE tenant_id = ${session.tenantId}::uuid
          AND status <> 'offboarded'
        ORDER BY department ASC, name ASC
      `);

      const leavesRows = await tx.execute(sql`
        SELECT la.id, la.employee_user_id, la.leave_type, la.duration, la.from_date, la.to_date,
               la.no_of_days, la.status, la.reason
        FROM leave_applications la
        WHERE la.tenant_id = ${session.tenantId}::uuid
          AND la.status IN ('requested', 'approved')
          AND la.from_date <= ${endDate}::date
          AND la.to_date >= ${startDate}::date
      `);

      return {
        stats: stats.rows[0] as any,
        users: usersRows.rows as any[],
        leaves: leavesRows.rows as any[],
      };
    } else {
      // Leave reasons are HR-sensitive, and this query had NO scoping at all —
      // anyone opening the page saw every employee's leave and their stated
      // reason. Same wall as the list API and the decide route now.
      const leaveScope = await resolveLeaveScope(tx, session);
      const conds: any[] = [
        sql`la.tenant_id = ${session.tenantId}::uuid`,
        leaveScopeSql(leaveScope, session.tenantId, "la"),
      ];
      if (q) conds.push(sql`u.name ILIKE ${`%${q}%`}`);
      if (statusFilter.length) conds.push(sql`la.status IN (${sql.join(statusFilter.map((v) => sql`${v}`), sql`, `)})`);
      if (mine) conds.push(sql`la.employee_user_id = ${session.userId}::uuid`);
      const whereSql = sql`WHERE ${sql.join(conds, sql` AND `)}`;

      const rows = await tx.execute(sql`
        SELECT la.id, la.employee_user_id, la.leave_type, la.duration, la.from_date, la.to_date,
               la.no_of_days, la.status, la.reason, la.created_at,
               u.name AS employee_name, a.name AS approver_name,
               u.desk_id AS employee_desk_id, u.roles AS employee_roles,
               u.reporting_manager_id AS employee_manager_id
        FROM leave_applications la
        LEFT JOIN users u ON u.id = la.employee_user_id
        LEFT JOIN users a ON a.id = la.approver_user_id
        ${whereSql}
        ORDER BY (la.status = 'requested') DESC, la.from_date DESC
        LIMIT 300
      `);

      return {
        stats: stats.rows[0] as any,
        // Decide rights are PER ROW, not per user: a branch head may act on
        // their desk's requests but not on another branch head's. Computed
        // here with the same rule the API enforces, so the table never offers
        // a button that would 403.
        rows: (rows.rows as any[]).map((r) => ({
          ...r,
          canDecide: decideLeaveCheck(session, leaveScope, {
            userId: r.employee_user_id,
            deskId: r.employee_desk_id ?? null,
            roles: Array.isArray(r.employee_roles) ? r.employee_roles : [],
            reportingManagerId: r.employee_manager_id ?? null,
          }).ok,
        })),
      };
    }
  });

  const s = data.stats;

  const getToggleUrl = (targetView: string) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (statusFilter.length) params.set("status", statusFilter.join(","));
    if (mine) params.set("mine", "1");
    if (sp.year) params.set("year", sp.year);
    if (sp.month) params.set("month", sp.month);
    params.set("view", targetView);
    return `?${params.toString()}`;
  };

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <CalendarOff className="size-6 text-brand-cyan" /> Leave Applications
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 bg-secondary/30 border border-border p-0.5 rounded-lg text-xs">
            <Link
              href={getToggleUrl("list")}
              className={`px-3 py-1.5 rounded-md font-medium transition-all ${view === "list"
                  ? "bg-background text-foreground shadow-sm font-semibold"
                  : "text-muted-foreground hover:text-foreground"
                }`}
            >
              List View
            </Link>
            <Link
              href={getToggleUrl("timeline")}
              className={`px-3 py-1.5 rounded-md font-medium transition-all ${view === "timeline"
                  ? "bg-background text-foreground shadow-sm font-semibold"
                  : "text-muted-foreground hover:text-foreground"
                }`}
            >
              Team Timeline
            </Link>
          </div>
          {canApprove && (
            <Link href="/dashboard/leave-applications/import" className="btn-secondary">
              <FileUp className="size-4" /> Bulk upload
            </Link>
          )}
          {canApprove && (
            <Link href="/dashboard/leave-applications/settings" className="btn-secondary">
              <SlidersHorizontal className="size-4" /> Leave policy
            </Link>
          )}
          <Link href="/dashboard/leave-applications/new" className="btn-primary">
            <Plus className="size-4" /> New request
          </Link>
        </div>
      </div>

      {view === "timeline" ? (
        <LeaveTimeline
          users={data.users || []}
          leaves={data.leaves || []}
          currentYear={year}
          currentMonth={month}
        />
      ) : (
        <>
          <CompactFilterBar
            totalCount={data.rows ? data.rows.length : 0}
            filters={[
              { type: "search", key: "q", placeholder: "Search by employee name…" },
              {
                type: "multi",
                key: "status",
                label: "Status",
                options: [
                  { value: "requested", label: "Requested" },
                  { value: "approved", label: "Approved" },
                  { value: "rejected", label: "Rejected" },
                  { value: "cancelled", label: "Cancelled" },
                ],
              },
              { type: "select", key: "mine", label: "Mine", options: [{ value: "1", label: "My requests" }] },
            ]}
            rightSlot={
              <CustomViews
                viewsKey="views:leave-applications"
                presets={[
                  { id: "pending", name: "Pending approval", params: "status=requested" },
                  { id: "mine", name: "My requests", params: "mine=1" },
                  { id: "approved", name: "Approved", params: "status=approved" },
                ]}
              />
            }
          />

          <LeaveTable rows={data.rows || []} canApprove={canApprove} currentUserId={session.userId} />
        </>
      )}
    </div>
  );
}

function Stat({ icon: Icon, label, value, tone }: { icon: any; label: string; value: number; tone?: "rose" | "amber" | "emerald" | "muted" }) {
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
