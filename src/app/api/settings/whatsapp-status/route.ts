import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/settings/whatsapp-status
 *
 * Read-only WhatsApp status for the mobile settings screen — the tenant's
 * WhatsApp numbers + Meta template approval counts (same data the web page
 * shows). Resilient: each query is best-effort so a not-yet-provisioned tenant
 * (or missing table) returns empty rather than 500.
 */

import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const session = await requireSession();
    const data = await withTenant(
      session.tenantId,
      async (tx) => {
        let numbers: any[] = [];
        let templates = { approved: 0, pending: 0, rejected: 0 };
        try {
          const n = await tx.execute(sql`SELECT phone_number, display_name, status FROM whatsapp_numbers ORDER BY created_at DESC LIMIT 10`);
          numbers = n.rows as any[];
        } catch {}
        try {
          const t = await tx.execute(sql`
            SELECT COUNT(*) FILTER (WHERE meta_status = 'APPROVED')::int AS approved,
                   COUNT(*) FILTER (WHERE meta_status = 'PENDING')::int AS pending,
                   COUNT(*) FILTER (WHERE meta_status = 'REJECTED')::int AS rejected
            FROM whatsapp_templates
          `);
          templates = (t.rows[0] as any) ?? templates;
        } catch {}
        return { numbers, templates };
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );
    return NextResponse.json(data);
  } catch (err) {
    return handleApiError(err);
  }
}
