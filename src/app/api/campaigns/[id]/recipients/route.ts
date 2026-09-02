/**
 * GET /api/campaigns/[id]/recipients?status=all|sent|delivered|read|replied|failed|bounced|skipped
 *
 * Per-recipient drill-down for a campaign's send — Zoho-style "click Opened /
 * Bounced to see who". Returns one row per recipient (name + status + time +
 * skip/fail reason) from the `communications` written during the broadcast.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { handleApiError } from "@/lib/api/error-handler";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireSession();
    const status = (new URL(req.url).searchParams.get("status") ?? "all").toLowerCase();

    const statusCond =
      status === "all" || status === ""
        ? sql``
        : status === "skipped"
          ? sql`AND c.status LIKE 'skipped%'`
          : sql`AND c.status = ${status}`;

    const data = await withTenant(session.tenantId, async (tx) => {
      const rows = await tx.execute(sql`
        SELECT c.id,
               c.status,
               c.status_reason   AS reason,
               c.channel,
               COALESCE(i.name, l.name, '—') AS name,
               c.created_at      AS created_at,
               COALESCE(c.read_at, c.delivered_at, c.sent_at, c.failed_at, c.created_at) AS when_ts
        FROM communications c
        LEFT JOIN investors i ON i.id = c.investor_id
        LEFT JOIN leads l ON l.id = c.lead_id
        WHERE c.tenant_id = ${session.tenantId}::uuid
          AND c.campaign_id = ${id}::uuid
          AND c.direction = 'outbound'
          ${statusCond}
        ORDER BY c.created_at DESC
        LIMIT 500
      `);
      return rows.rows as any[];
    });

    return NextResponse.json({
      recipients: data.map((r) => ({
        id: r.id,
        name: r.name,
        status: r.status,
        reason: r.reason ?? null,
        channel: r.channel,
        when: r.when_ts ?? r.created_at ?? null,
      })),
    });
  } catch (err) {
    return handleApiError(err);
  }
}
