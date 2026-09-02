import { handleApiError } from "@/lib/api/error-handler";
import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql, ne } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { leaveApplications, users } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    const sp = req.nextUrl.searchParams;
    const employeeId = sp.get("employeeId");
    const fromDate = sp.get("fromDate");
    const toDate = sp.get("toDate");

    if (!employeeId || !fromDate || !toDate) {
      return NextResponse.json({ error: "Missing parameters" }, { status: 400 });
    }

    const conflicts = await withTenant(session.tenantId, async (tx) => {
      // 1. Get the department of the selected employee
      const [emp] = await tx
        .select({ department: users.department })
        .from(users)
        .where(and(eq(users.id, employeeId), eq(users.tenantId, session.tenantId)))
        .limit(1);

      if (!emp || !emp.department) return [];

      // 2. Fetch overlapping leaves for employees in the same department
      const rows = await tx.execute(sql`
        SELECT la.id, la.from_date, la.to_date, la.leave_type, u.name AS employee_name
        FROM leave_applications la
        JOIN users u ON u.id = la.employee_user_id
        WHERE la.tenant_id = ${session.tenantId}::uuid
          AND la.employee_user_id <> ${employeeId}::uuid
          AND u.department = ${emp.department}
          AND la.status IN ('requested', 'approved')
          AND la.from_date <= ${toDate}::date
          AND la.to_date >= ${fromDate}::date
        ORDER BY la.from_date ASC
      `);

      return rows.rows;
    });

    return NextResponse.json({ conflicts });
  } catch (err: any) {
    return handleApiError(err);
  }
}
