import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";

/**
 * GET /api/rta-imports/:id
 *
 * Status of a single RTA import. The upload dialog polls this after enqueuing
 * the parse (the work now runs in the background worker) until the status is
 * terminal (completed | partial | failed | rejected), then renders the outcome.
 */
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();

  const row = await withTenant(session.tenantId, async (tx) => {
    const r = await tx.execute(sql`
      SELECT id, source, kind, status, period_start, period_end,
             rows_total, rows_imported, rows_skipped, rows_failed,
             errors, summary, remarks, file_name, parsed_at, created_at
      FROM rta_file_imports
      WHERE id = ${id}::uuid
      LIMIT 1
    `);
    return r.rows[0] ?? null;
  });

  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(row);
}

/**
 * DELETE /api/rta-imports/:id
 *   Default → move the import record to Trash (soft-delete; recoverable).
 *   ?purge=1 → permanently remove the import-history row.
 * Either way the already-imported transactions/folios are untouched — this only
 * affects the upload-history entry.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  requireCap(session.roles, "transactions.execute", session.permissions);
  const purge = req.nextUrl.searchParams.get("purge") === "1";

  const ok = await withTenant(session.tenantId, async (tx) => {
    if (purge) {
      const r = await tx.execute(
        sql`DELETE FROM rta_file_imports WHERE id = ${id}::uuid AND tenant_id = ${session.tenantId}::uuid RETURNING id`
      );
      return (r.rows as any[]).length > 0;
    }
    const r = await tx.execute(
      sql`UPDATE rta_file_imports SET deleted_at = now(), updated_at = now()
          WHERE id = ${id}::uuid AND tenant_id = ${session.tenantId}::uuid AND deleted_at IS NULL RETURNING id`
    );
    return (r.rows as any[]).length > 0;
  });

  if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true, trashed: !purge });
}
