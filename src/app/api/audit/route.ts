import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/audit?entityType=investor&entityId=…  — per-record change history
 * (Sanchay "Change Log" parity). Reads the append-only audit_log, RLS-scoped,
 * newest first. Powers the ChangeLog drawer on detail pages.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

// Entity histories that expose privileged config / PII / compliance evidence.
// Reading these requires a management role; ordinary record histories
// (investor/lead/task/…) stay open to any internal user for the ChangeLog drawer.
const SENSITIVE_ENTITY_TYPES = new Set([
  "user",
  "tenant",
  "tenant_integration",
  "integration",
  "compliance_document",
  "ddq_checklist",
  "consent",
  "sop",
  "audit_log",
  "license",
]);

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    const sp = req.nextUrl.searchParams;
    const entityType = (sp.get("entityType") ?? "").trim();
    const entityId = (sp.get("entityId") ?? "").trim();
    if (!entityType || !entityId) return NextResponse.json({ error: "entityType and entityId are required" }, { status: 400 });

    // Privileged histories are gated; everyone else can read normal record logs.
    if (SENSITIVE_ENTITY_TYPES.has(entityType)) {
      const privileged = session.roles.some((r: string) => ["owner", "compliance", "branch_head"].includes(r));
      if (!privileged) {
        return NextResponse.json({ error: "forbidden — management roles only for this record type" }, { status: 403 });
      }
    }

    const rows = await withTenant(session.tenantId, async (tx) => {
      const r = await tx.execute(sql`
        SELECT a.id, a.action, a.actor_type, a.at, a.before, a.after, a.reason,
               u.name AS actor_name
        FROM audit_log a LEFT JOIN users u ON u.id = a.actor_user_id
        WHERE a.tenant_id = ${session.tenantId}::uuid
          AND a.entity_type = ${entityType}
          AND a.entity_id = ${entityId}::uuid
        ORDER BY a.at DESC
        LIMIT 200
      `);
      return r.rows as any[];
    });
    return NextResponse.json({ entries: rows });
  } catch (err: any) {
    return handleApiError(err);
  }
}
