import Link from "next/link";
import { sql } from "drizzle-orm";
import { ChevronLeft, CalendarOff } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { currentFyStart } from "@/lib/leave/policy";
import { loadLeavePolicy } from "@/lib/leave/settings";
import { LeaveForm } from "@/components/leave/LeaveForm";

export const dynamic = "force-dynamic";

export default async function NewLeavePage() {
  const session = await requireSession();
  const fyStart = currentFyStart();

  const { employees, usage, policy } = await withTenant(session.tenantId, async (tx) => {
    const emp = await tx.execute(sql`
      SELECT id, name, custom_leave_entitlements, joining_date FROM users
      WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active'
      ORDER BY name
    `);
    const use = await tx.execute(sql`
      SELECT employee_user_id, leave_type, COALESCE(SUM(no_of_days), 0)::numeric AS used
      FROM leave_applications
      WHERE tenant_id = ${session.tenantId}::uuid AND status = 'approved' AND from_date >= ${fyStart}::date
      GROUP BY employee_user_id, leave_type
    `);
    const policy = await loadLeavePolicy(tx, session.tenantId);
    return { employees: emp.rows as any[], usage: use.rows as any[], policy };
  });

  const isManager = can(session.roles, "leave.manage.all", session.permissions);

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <Link href="/dashboard/leave-applications" className="text-sm text-muted-foreground hover:underline flex items-center gap-1">
        <ChevronLeft className="size-4" /> Back to leave applications
      </Link>
      <div className="card-surface p-6 flex items-start gap-4">
        <div className="size-12 rounded-lg bg-brand-cyan-light grid place-items-center">
          <CalendarOff className="size-6 text-brand-cyan" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">File a leave request</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Your reporting manager (or an owner) is notified to approve. Balances are shown against this year's policy.
          </p>
        </div>
      </div>

      <LeaveForm
        employees={employees}
        usage={usage}
        currentUserId={session.userId}
        isManager={isManager}
        tenantEntitlements={policy.entitlements}
        annualTotal={policy.annualTotal}
        monthlyAccrual={policy.monthlyAccrual}
      />
    </div>
  );
}
