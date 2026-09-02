import Link from "next/link";
import { sql } from "drizzle-orm";
import { ArrowLeft, ClipboardCheck, Clock } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { RegularizationForm } from "@/components/attendance/RegularizationForm";
import { RegularizationTable } from "@/components/attendance/RegularizationTable";

export const dynamic = "force-dynamic";

export default async function RegularizationsPage() {
  const session = await requireSession();
  const canManage = session.roles.some((r) => ["owner", "branch_head"].includes(r));

  const data = await withTenant(session.tenantId, async (tx) => {
    const stats = await tx.execute(sql`
      SELECT COUNT(*) FILTER (WHERE status = 'requested')::int AS pending
      FROM attendance_regularizations
      WHERE tenant_id = ${session.tenantId}::uuid
        ${canManage ? sql`` : sql`AND employee_user_id = ${session.userId}::uuid`}
    `);

    const rows = await tx.execute(sql`
      SELECT ar.id, ar.employee_user_id, ar.attendance_date, ar.requested_status,
             ar.requested_clock_in_at, ar.requested_clock_out_at, ar.reason,
             ar.status, ar.decision_notes, ar.created_at,
             u.name AS employee_name, rv.name AS reviewer_name
      FROM attendance_regularizations ar
      LEFT JOIN users u ON u.id = ar.employee_user_id
      LEFT JOIN users rv ON rv.id = ar.reviewer_user_id
      WHERE ar.tenant_id = ${session.tenantId}::uuid
        ${canManage ? sql`` : sql`AND ar.employee_user_id = ${session.userId}::uuid`}
      ORDER BY (ar.status = 'requested') DESC, ar.attendance_date DESC, ar.created_at DESC
      LIMIT 300
    `);

    const employees = canManage
      ? await tx.execute(sql`
          SELECT id, name FROM users
          WHERE tenant_id = ${session.tenantId}::uuid AND status <> 'offboarded'
          ORDER BY name ASC
        `)
      : { rows: [] as any[] };

    return {
      pending: (stats.rows[0] as any)?.pending ?? 0,
      rows: rows.rows as any[],
      employees: employees.rows as any[],
    };
  });

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <Link href="/dashboard/attendance" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          <ArrowLeft className="size-3.5" /> Back to Attendance
        </Link>
      </div>

      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <ClipboardCheck className="size-6 text-brand-cyan" /> Attendance Corrections
          </h1>
          <p className="text-muted-foreground text-sm">
            Regularization requests · missed punches · wrong-status fixes · approval workflow.
          </p>
        </div>
      </div>

      <RegularizationForm
        employees={data.employees}
        currentUserId={session.userId}
        isManager={canManage}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="card-surface p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Pending approval</span>
            <Clock className="size-3.5 text-muted-foreground" />
          </div>
          <div className={`text-2xl font-bold mt-1 tabular-nums ${data.pending > 0 ? "text-amber-600" : "text-foreground"}`}>
            {data.pending}
          </div>
        </div>
      </div>

      <RegularizationTable rows={data.rows} canManage={canManage} currentUserId={session.userId} />
    </div>
  );
}
