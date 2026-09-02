import { handleApiError } from "@/lib/api/error-handler";
/** POST /api/cadences/run-due — materialise due cadence steps (worker/manual). */
import { NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { advanceDueCadences } from "@/lib/cadences/runner";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const session = await requireSession();
    if (!session.roles.some((r: string) => ["owner", "branch_head"].includes(r))) return NextResponse.json({ error: "not allowed" }, { status: 403 });
    const n = await withTenant(session.tenantId, (tx) => advanceDueCadences(tx as any, session.tenantId),
      { userId: session.userId, branchId: session.branchId, roles: session.roles });
    return NextResponse.json({ materialised: n });
  } catch (err: any) { return handleApiError(err); }
}
