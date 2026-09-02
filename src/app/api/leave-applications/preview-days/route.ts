import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/leave-applications/preview-days?from=YYYY-MM-DD&to=YYYY-MM-DD&duration=full_day|half_day
 * Returns the working-day count (excluding the firm's weekly-offs + holidays) so
 * the leave form shows the same number the server will store.
 */
import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { leaveWorkingDays } from "@/lib/leave/working-days";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    const url = new URL(req.url);
    const from = (url.searchParams.get("from") ?? "").slice(0, 10);
    const duration = url.searchParams.get("duration") === "half_day" ? "half_day" : "full_day";
    const to = duration === "half_day" ? from : (url.searchParams.get("to") ?? from).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from) {
      return NextResponse.json({ days: 0 });
    }
    const days = await withTenant(session.tenantId, (tx) => leaveWorkingDays(tx as any, session.tenantId, from, to, duration));
    return NextResponse.json({ days });
  } catch (err: any) {
    return handleApiError(err);
  }
}
