import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/audit/export?days=&actor=&user=&action=&pii=1  — CSV of the filtered
 * audit window for compliance hand-off (DPDP / SEBI). Management-only
 * (owner / compliance), mirroring the audit-log page gate. RLS-scoped.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const AUDIT_ROLES = ["owner", "compliance"];

/** Escape one CSV field — wrap in quotes, double internal quotes. */
function csv(value: unknown): string {
  const s = value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    if (!session.roles.some((r) => AUDIT_ROLES.includes(r))) {
      return NextResponse.json({ error: "only an owner or compliance officer can export the audit log" }, { status: 403 });
    }

    const sp = req.nextUrl.searchParams;
    const days = Math.min(366, Math.max(1, Number(sp.get("days") ?? "7") || 7));
    const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const actionQ = (sp.get("action") ?? "").trim();
    const actor = (sp.get("actor") ?? "").trim();
    const user = (sp.get("user") ?? "").trim();
    const piiOnly = sp.get("pii") === "1";

    const conds = [sql`a.at >= ${fromDate.toISOString()}`];
    if (actionQ) conds.push(sql`a.action ILIKE ${"%" + actionQ + "%"}`);
    if (actor) conds.push(sql`a.actor_type = ${actor}`);
    if (user) conds.push(sql`a.actor_user_id = ${user}::uuid`);
    if (piiOnly) conds.push(sql`a.pii_accessed IS NOT NULL AND a.pii_accessed <> '{}'::jsonb`);
    const whereSql = conds.reduce((acc, c, i) => (i === 0 ? c : sql`${acc} AND ${c}`));

    const rows = await withTenant(session.tenantId, async (tx) => {
      const r = await tx.execute(sql`
        SELECT a.at, a.actor_type, COALESCE(u.name, a.actor_type) AS actor_name, a.action,
               a.entity_type, a.entity_id, a.reason,
               (a.pii_accessed IS NOT NULL AND a.pii_accessed <> '{}'::jsonb) AS pii,
               a.pii_accessed, a.ip_address, a.user_agent
        FROM audit_log a
        LEFT JOIN users u ON u.id = a.actor_user_id
        WHERE ${whereSql}
        ORDER BY a.at DESC
        LIMIT 50000
      `);
      return r.rows as any[];
    });

    const header = ["timestamp_ist", "actor", "actor_type", "action", "entity_type", "entity_id", "reason", "pii_access", "pii_fields", "ip_address", "user_agent"];
    const lines = [header.join(",")];
    for (const r of rows) {
      const istTs = new Date(r.at).toLocaleString("en-GB", { timeZone: "Asia/Kolkata", dateStyle: "short", timeStyle: "medium" });
      const piiFields = r.pii_accessed ? Object.keys(r.pii_accessed).join("; ") : "";
      lines.push([
        csv(istTs), csv(r.actor_name), csv(r.actor_type), csv(r.action), csv(r.entity_type), csv(r.entity_id),
        csv(r.reason), csv(r.pii ? "yes" : "no"), csv(piiFields), csv(r.ip_address), csv(r.user_agent),
      ].join(","));
    }

    const stamp = new Date().toISOString().slice(0, 10);
    return new NextResponse("﻿" + lines.join("\r\n"), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="audit-log-${stamp}-${days}d.csv"`,
      },
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}
