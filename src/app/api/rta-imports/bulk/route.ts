import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/rta-imports/bulk — apply one action to many RTA import records.
 *   action = "trash"   → soft-delete (move to Trash, recoverable)
 *          = "restore" → recover from Trash
 *          = "purge"   → permanently remove the history rows
 * Only the upload-history rows are affected; imported transactions/folios stay.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";

export const dynamic = "force-dynamic";

const Body = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
  action: z.enum(["trash", "restore", "purge"]),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "transactions.execute", session.permissions);
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    const { ids, action } = parse.data;

    const affected = await withTenant(session.tenantId, async (tx) => {
      const idArr = sql.join(ids.map((x) => sql`${x}::uuid`), sql`, `);
      let r;
      if (action === "purge") {
        r = await tx.execute(
          sql`DELETE FROM rta_file_imports WHERE tenant_id = ${session.tenantId}::uuid AND id IN (${idArr}) RETURNING id`
        );
      } else if (action === "restore") {
        r = await tx.execute(
          sql`UPDATE rta_file_imports SET deleted_at = NULL, updated_at = now()
              WHERE tenant_id = ${session.tenantId}::uuid AND id IN (${idArr}) RETURNING id`
        );
      } else {
        r = await tx.execute(
          sql`UPDATE rta_file_imports SET deleted_at = now(), updated_at = now()
              WHERE tenant_id = ${session.tenantId}::uuid AND id IN (${idArr}) AND deleted_at IS NULL RETURNING id`
        );
      }
      return (r.rows as any[]).length;
    });

    return NextResponse.json({ ok: true, affected });
  } catch (err: any) {
    return handleApiError(err);
  }
}
