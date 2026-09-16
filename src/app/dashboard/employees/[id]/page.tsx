import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { eq, sql, and, inArray } from "drizzle-orm";
import { ChevronLeft, UserCog, Briefcase, Users, IndianRupee, CheckCircle2, AlertTriangle, Calendar } from "lucide-react";
import { withTenant } from "@/db/client";
import { users, complianceDocuments, tasks, reviewMeetings } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { loadTenantLicense } from "@/lib/auth/license";
import { tenantAccessibleNavKeys } from "@/config/nav-access";
import { formatINR, formatDate } from "@/lib/utils";
import { EmployeeEditForm } from "@/components/employees/EmployeeEditForm";
import { RecordProvenance } from "@/components/common/RecordProvenance";
import { accruedPoolDays, pooledUsed, POOLED_LEAVE_TYPES, currentFyStart } from "@/lib/leave/policy";
import { loadLeavePolicy } from "@/lib/leave/settings";

export const dynamic = "force-dynamic";

export default async function EmployeeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  // Team management is firm-admin only — same gate as the Employees list.
  if (!can(session.roles, "settings.users", session.permissions)) redirect("/dashboard");
  const { id } = await params;
  // The modules the tenant has — the pool an owner can grant to a team member.
  const license = await loadTenantLicense(session.tenantId, session.roles);

  const data = await withTenant(session.tenantId, async (tx) => {
    const [emp] = await tx.select().from(users).where(eq(users.id, id));
    if (!emp) return null;

    // All teammates for the "reporting manager" picker
    const teammates = await tx
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .orderBy(users.name);

    // The firm's branches — the pool an admin can grant data access to.
    const branchRows = await tx.execute(sql`
      SELECT id, name FROM branches
      WHERE tenant_id = ${session.tenantId}::uuid
      ORDER BY name ASC
    `);

    const stats = await tx.execute(sql`
      SELECT
        (SELECT COUNT(*)::int FROM investors WHERE rm_id = ${id}::uuid AND status = 'active') AS active_clients,
        (SELECT COALESCE(SUM(aum::numeric),0)::numeric FROM investors WHERE rm_id = ${id}::uuid AND status = 'active') AS my_aum,
        (SELECT COALESCE(SUM(active_sip_amount::numeric),0)::numeric FROM investors WHERE rm_id = ${id}::uuid AND status = 'active') AS my_sip,
        (SELECT COUNT(*)::int FROM tasks WHERE assignee_id = ${id}::uuid AND status IN ('open','in_progress')) AS open_tasks,
        (SELECT COUNT(*)::int FROM tasks WHERE assignee_id = ${id}::uuid AND status IN ('open','in_progress') AND due_at < now()) AS overdue_tasks,
        (SELECT COUNT(*)::int FROM review_meetings WHERE rm_id = ${id}::uuid AND status IN ('scheduled','confirmed') AND meeting_date >= now()) AS upcoming_meetings
    `);

    // ── Attendance (month-to-date) + leave (current FY) summary ──
    const attMtd = await tx.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'present')::int AS present,
        COUNT(*) FILTER (WHERE status = 'half_day')::int AS half_day,
        COUNT(*) FILTER (WHERE status = 'absent')::int AS absent,
        COUNT(*) FILTER (WHERE status = 'on_leave')::int AS on_leave,
        COUNT(*) FILTER (WHERE status NOT IN ('week_off','holiday'))::int AS working_days
      FROM attendance
      WHERE tenant_id = ${session.tenantId}::uuid AND employee_user_id = ${id}::uuid
        AND attendance_date >= date_trunc('month', current_date)
    `);
    const leaveUsed = await tx.execute(sql`
      SELECT leave_type, COALESCE(SUM(no_of_days), 0)::numeric AS used
      FROM leave_applications
      WHERE tenant_id = ${session.tenantId}::uuid AND employee_user_id = ${id}::uuid
        AND status = 'approved' AND from_date >= ${currentFyStart()}
      GROUP BY leave_type
    `);
    const pendingLeave = await tx.execute(sql`
      SELECT COUNT(*)::int AS n FROM leave_applications
      WHERE tenant_id = ${session.tenantId}::uuid AND employee_user_id = ${id}::uuid AND status = 'requested'
    `);

    // Fetch compliance documents linked to this employee
    const docs = await tx
      .select()
      .from(complianceDocuments)
      .where(
        and(
          eq(complianceDocuments.tenantId, session.tenantId),
          eq(complianceDocuments.relatedEntityType, "user"),
          eq(complianceDocuments.relatedEntityId, id)
        )
      );

    // Fetch audit logs for this employee
    const logs = await tx.execute(sql`
      SELECT a.id, a.action, a.at, a.before, a.after, u.name AS actor_name
      FROM audit_log a
      LEFT JOIN users u ON u.id = a.actor_user_id
      WHERE a.tenant_id = ${session.tenantId}::uuid
        AND a.entity_type = 'user'
        AND a.entity_id = ${id}::uuid
      ORDER BY a.at DESC LIMIT 50
    `);

    // Fetch tasks assigned to this employee
    const assignedTasks = await tx
      .select({
        id: tasks.id,
        title: tasks.title,
        status: tasks.status,
        priority: tasks.priority,
        dueAt: tasks.dueAt,
      })
      .from(tasks)
      .where(
        and(
          eq(tasks.tenantId, session.tenantId),
          eq(tasks.assigneeId, id)
        )
      )
      .orderBy(tasks.dueAt);

    // Fetch review meetings assigned to this employee
    const assignedMeetings = await tx
      .select({
        id: reviewMeetings.id,
        subject: reviewMeetings.subject,
        meetingType: reviewMeetings.meetingType,
        meetingDate: reviewMeetings.meetingDate,
        status: reviewMeetings.status,
      })
      .from(reviewMeetings)
      .where(
        and(
          eq(reviewMeetings.tenantId, session.tenantId),
          eq(reviewMeetings.rmId, id),
          inArray(reviewMeetings.status, ["scheduled", "confirmed", "in_progress"])
        )
      )
      .orderBy(reviewMeetings.meetingDate);

    // Resolve manager name (if any)
    const managerId = (emp as any).reportingManagerId as string | null;
    let manager: { id: string; name: string } | null = null;
    if (managerId) {
      const [m] = await tx
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(eq(users.id, managerId));
      manager = m ?? null;
    }
    const policy = await loadLeavePolicy(tx, session.tenantId);
    return {
      emp,
      policy,
      teammates,
      branches: branchRows.rows as unknown as { id: string; name: string }[],
      stats: stats.rows[0] as any,
      manager,
      docs,
      logs: logs.rows as any[],
      assignedTasks,
      assignedMeetings,
      attMtd: attMtd.rows[0] as any,
      leaveUsed: leaveUsed.rows as Array<{ leave_type: string; used: string }>,
      pendingLeave: Number((pendingLeave.rows[0] as any)?.n ?? 0),
    };
  });
  if (!data) notFound();
  const { emp, teammates, stats, manager } = data;
  const branches = data.branches ?? [];

  // ── HR summary derivations ──
  const att = data.attMtd ?? {};
  const presentEq = Number(att.present ?? 0) + Number(att.half_day ?? 0) * 0.5;
  const workingDays = Number(att.working_days ?? 0);
  const attendancePct = workingDays > 0 ? Math.round((presentEq / workingDays) * 100) : null;
  const usedByType: Record<string, number> = {};
  for (const r of data.leaveUsed) usedByType[r.leave_type] = Number(r.used ?? 0);
  const custom = (emp as any).customLeaveEntitlements as Record<string, number> | null;
  // One accruing pool across casual/sick/earned. The per-type strip below still
  // shows where the days went, but the BALANCE is a single number — summing
  // three per-type balances used to report roughly double the real allowance.
  const accrued = accruedPoolDays({
    joiningDate: emp.joiningDate as string | null,
    annualTotal: data.policy.annualTotal,
    monthlyAccrual: data.policy.monthlyAccrual,
  });
  const leaveBalance = POOLED_LEAVE_TYPES.map((t) => ({ type: t, used: usedByType[t] ?? 0 }));
  const totalLeaveBalance = Math.max(0, accrued - pooledUsed(usedByType));

  return (
    <div className="space-y-6 max-w-5xl">
      <Link href="/dashboard/employees" className="text-xs text-muted-foreground hover:underline inline-flex items-center gap-1">
        <ChevronLeft className="size-3" /> Back to employees
      </Link>

      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">
            <UserCog className="size-6 text-brand-cyan" /> {emp.name}
          </h1>
          <p className="page-subtitle">
            {emp.email}
            {emp.phone ? <> · {emp.phone}</> : null}
            {manager ? <> · Reports to <strong>{manager.name}</strong></> : null}
          </p>
          <RecordProvenance
            entityType="user"
            entityId={emp.id}
            createdAt={emp.createdAt}
            updatedAt={emp.updatedAt}
            className="mt-1.5"
          />
        </div>
        <span
          className={`chip ${
            emp.status === "active"
              ? "bg-emerald-50 text-emerald-700"
              : emp.status === "suspended"
                ? "bg-rose-50 text-rose-700"
                : "bg-secondary"
          }`}
        >
          {emp.status}
        </span>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
        <Tile icon={Users} label="Active clients" value={String(stats.active_clients ?? 0)} />
        <Tile icon={IndianRupee} label="AUM" value={Number(stats.my_aum ?? 0) > 0 ? formatINR(Number(stats.my_aum)) : "—"} accent="emerald" />
        <Tile icon={IndianRupee} label="Active SIP" value={Number(stats.my_sip ?? 0) > 0 ? formatINR(Number(stats.my_sip)) : "—"} accent="emerald" />
        <Tile icon={CheckCircle2} label="Open tasks" value={String(stats.open_tasks ?? 0)} />
        <Tile icon={AlertTriangle} label="Overdue" value={String(stats.overdue_tasks ?? 0)} accent={Number(stats.overdue_tasks) > 0 ? "rose" : "muted"} />
        <Tile icon={Calendar} label="Upcoming meetings" value={String(stats.upcoming_meetings ?? 0)} />
      </div>

      {/* HR strip — attendance (MTD) + leave (current FY) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile
          icon={Calendar}
          label="Attendance (MTD)"
          value={attendancePct != null ? `${attendancePct}%` : "—"}
          accent={attendancePct != null && attendancePct < 80 ? "rose" : attendancePct != null ? "emerald" : "muted"}
        />
        <Tile icon={CheckCircle2} label={`Leave left (${accrued} earned of ${data.policy.annualTotal})`} value={String(totalLeaveBalance)} accent="emerald" />
        <Tile icon={AlertTriangle} label="Pending leave" value={String(data.pendingLeave)} accent={data.pendingLeave > 0 ? "amber" : "muted"} />
        <div className="card-surface p-3">
          <div className="flex items-center justify-between text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
            <span>Leave used</span>
            <Calendar className="size-3 text-muted-foreground" />
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
            {leaveBalance.map((l) => (
              <span key={l.type} className="tabular-nums">
                <span className="capitalize text-muted-foreground">{l.type}</span>{" "}
                <span className="font-semibold">{l.used}</span>
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Quick HR summary */}
      <div className="grid grid-cols-2 gap-3">
        <SummaryRow icon={Briefcase} label="Department" value={emp.department ? cap(emp.department.replace(/_/g, " ")) : "—"} />
        <SummaryRow icon={Calendar} label="Joining date" value={emp.joiningDate ? formatDate(emp.joiningDate) : "—"} />
        <SummaryRow
          icon={IndianRupee}
          label="Annual target"
          value={(emp as any).annualTarget ? formatINR(Number((emp as any).annualTarget)) : "—"}
        />
        <SummaryRow
          icon={IndianRupee}
          label="Monthly SIP target"
          value={(emp as any).sipMonthlyTarget ? formatINR(Number((emp as any).sipMonthlyTarget)) : "—"}
        />
      </div>

      {/* Edit form */}
      <EmployeeEditForm
        employee={{
          id: emp.id,
          name: emp.name,
          email: emp.email,
          phone: emp.phone ?? "",
          roles: (emp.roles as string[]) ?? [],
          department: (emp as any).department ?? null,
          joiningDate: (emp as any).joiningDate ?? null,
          reportingManagerId: (emp as any).reportingManagerId ?? null,
          annualTarget: (emp as any).annualTarget ? Number((emp as any).annualTarget) : null,
          sipMonthlyTarget: (emp as any).sipMonthlyTarget ? Number((emp as any).sipMonthlyTarget) : null,
          notes: (emp as any).notes ?? "",
          employeeCode: (emp as any).employeeCode ?? "",
          distributingAmcs: ((emp as any).distributingAmcs as string[] | null) ?? [],
          euin: emp.euin ?? "",
          euinExpiryAt: ((emp as any).euinExpiryAt as string | null) ?? null,
          nismCertificateNo: emp.nismCertificateNo ?? "",
          nismExamDate: ((emp as any).nismExamDate as string | null) ?? null,
          nismExpiryAt: emp.nismExpiryAt ?? null,
          nismCategory: ((emp as any).nismCategory as string | null) ?? "",
          personalArn: ((emp as any).personalArn as string | null) ?? "",
          arnRegistrationDate:
            ((emp as any).arnRegistrationDate as string | null) ?? null,
          arnExpiryAt: ((emp as any).arnExpiryAt as string | null) ?? null,
          dscSubmitted: !!((emp as any).dscSubmitted),
          dscLastSubmittedAt:
            ((emp as any).dscLastSubmittedAt as string | null) ?? null,
          dscExpiryAt: ((emp as any).dscExpiryAt as string | null) ?? null,
          status: emp.status,
          permissions: (emp as any).permissions as string[] | null,
          enabledModules: ((emp as any).enabledModules as string[] | null) ?? null,
          allowedBranches: emp.allowedBranches ?? null,
          customLeaveEntitlements: (emp as any).customLeaveEntitlements as Record<string, number> | null,
        }}
        branches={branches}
        tenantNavKeys={tenantAccessibleNavKeys({
          allowedNav: license.allowedNav,
          enabledModules: license.enabledModules,
          enabledFeatures: license.enabledFeatures,
        })}
        teammates={teammates.filter((t) => t.id !== id)}
        docs={data.docs}
        logs={data.logs}
        tasks={data.assignedTasks}
        meetings={data.assignedMeetings}
        stats={stats}
      />
    </div>
  );
}

function Tile({ icon: Icon, label, value, accent }: { icon: any; label: string; value: string; accent?: "emerald" | "rose" | "amber" | "muted" }) {
  const color =
    accent === "emerald" ? "text-emerald-600" : accent === "rose" ? "text-rose-600" : accent === "amber" ? "text-amber-600" : "text-foreground";
  return (
    <div className="card-surface p-3">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
        <span>{label}</span>
        <Icon className="size-3 text-muted-foreground" />
      </div>
      <div className={`text-xl font-bold mt-1 tabular-nums ${color}`}>{value}</div>
    </div>
  );
}

function SummaryRow({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="card-surface p-3 flex items-center gap-3">
      <Icon className="size-4 text-brand-cyan" />
      <div>
        <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">{label}</div>
        <div className="text-sm font-medium">{value}</div>
      </div>
    </div>
  );
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
