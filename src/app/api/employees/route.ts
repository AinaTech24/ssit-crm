import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/employees
 *   List active team members for the current tenant. Used by every
 *   "Assign RM" / "Owner" picker across the app (leads, investors,
 *   meetings, tasks, SRs, …).
 *
 *   Query params:
 *     - role=rm|owner|back_office|... — filter by role (any-match on roles[])
 *     - q=<search> — name/email substring
 *
 *   The response is intentionally lightweight ({id, name, email, roles,
 *   department}) so the picker stays snappy with hundreds of employees.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { users } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    const sp = req.nextUrl.searchParams;
    const roleList = sp.getAll("role").map((r) => r.trim()).filter(Boolean);
    const q = sp.get("q")?.trim() || null;

    const rows = await withTenant(session.tenantId, async (tx) => {
      const conds: any[] = [eq(users.status, "active")];
      if (q) {
        conds.push(or(ilike(users.name, `%${q}%`), ilike(users.email, `%${q}%`)));
      }
      if (roleList.length) {
        // ANY of the requested roles — overlap, not containment, so a picker can
        // offer back office + marketing + research from one call.
        conds.push(sql`${users.roles} && ARRAY[${sql.join(roleList.map((r) => sql`${r}`), sql`, `)}]::text[]`);
      }
      return await tx
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          roles: users.roles,
          department: users.department,
        })
        .from(users)
        .where(and(...conds))
        .orderBy(users.name)
        .limit(300);
    }, { userId: session.userId, branchId: session.branchId, roles: session.roles });

    return NextResponse.json({ rows });
  } catch (err: any) {
    return handleApiError(err);
  }
}
