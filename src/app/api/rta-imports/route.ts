import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";

/**
 * GET /api/rta-imports
 *
 * Returns every RTA file import for the tenant, ordered by upload time.
 * Used by the dashboard tiles + the audit table.
 */
export async function GET(_req: NextRequest) {
  const session = await requireSession();

  const data = await withTenant(session.tenantId, async (tx) => {
    const rows = await tx.execute(sql`
      SELECT
        rfi.id, rfi.source, rfi.kind, rfi.period_start, rfi.period_end,
        rfi.file_name, rfi.file_size_bytes, rfi.status, rfi.parsed_at,
        rfi.rows_total, rfi.rows_imported, rfi.rows_skipped, rfi.rows_failed,
        rfi.errors, rfi.remarks, rfi.created_at, rfi.uploaded_by,
        u.name AS uploaded_by_name
      FROM rta_file_imports rfi
      LEFT JOIN users u ON u.id = rfi.uploaded_by
      ORDER BY rfi.created_at DESC
      LIMIT 100
    `);

    /** Per-kind latest import — drives the "last uploaded" tiles. */
    const latest = await tx.execute(sql`
      SELECT DISTINCT ON (kind)
        kind, source, period_end, status, parsed_at, rows_imported, created_at
      FROM rta_file_imports
      WHERE status IN ('completed', 'partial')
      ORDER BY kind, period_end DESC, created_at DESC
    `);

    return { rows: rows.rows, latest: latest.rows };
  });

  return NextResponse.json(data);
}
