import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/complaints/disclosure/export?month=YYYY-MM
 *
 * CSV of the SEBI monthly complaint disclosure (headline counts + category +
 * source breakdowns) for the requested month. Read-only, RLS-scoped.
 */

import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { computeDisclosure, normalizeMonth } from "@/lib/complaints/disclosure";

export const dynamic = "force-dynamic";

function csvCell(v: string | number): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    const now = new Date();
    const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const month = normalizeMonth(req.nextUrl.searchParams.get("month") ?? undefined, current);

    const d = await withTenant(session.tenantId, (tx) => computeDisclosure(tx, session.tenantId, month));

    const lines: Array<Array<string | number>> = [
      ["Monthly Complaint Disclosure", d.label],
      [],
      ["Metric", "Count"],
      ["Pending at start", d.pendingStart],
      ["Received in month", d.received],
      ["Resolved in month", d.resolved],
      ["Pending at end", d.pendingEnd],
      [],
      ["Received by SEBI category", ""],
      ["Category", "Count"],
      ...d.byCategory.map((r) => [r.label, r.count]),
      [],
      ["Received by source", ""],
      ["Source", "Count"],
      ...d.bySource.map((r) => [r.label, r.count]),
    ];

    const csv = lines.map((row) => row.map(csvCell).join(",")).join("\r\n");
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="complaint-disclosure-${d.month}.csv"`,
      },
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}
