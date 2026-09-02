/**
 * POST /api/internal/proposals/mark-expired
 *
 * Periodic worker — finds proposals past their valid_until date that are
 * still sent / viewed (not approved), flips status to "expired", and emits
 * an outbox event for the reminder/revise recipe.
 *
 * Schedule: nightly.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withSystem } from "@/db/client";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const token = process.env.INTERNAL_API_TOKEN;
  if (!token || auth !== `Bearer ${token}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const out = await withSystem(async (tx) => {
    const expired = await tx.execute(sql`
      UPDATE proposals
         SET status = 'expired',
             is_expired = true,
             expired_at = now(),
             updated_at = now()
       WHERE valid_until IS NOT NULL
         AND valid_until < current_date
         AND status IN ('sent', 'viewed', 'ready')
         AND is_expired = false
       RETURNING id, tenant_id, lead_id, proposal_number, recipient_name
    `);

    for (const r of expired.rows as any[]) {
      await tx.execute(sql`
        INSERT INTO events_outbox (tenant_id, kind, entity_type, entity_id, after, meta)
        VALUES (
          ${r.tenant_id}::uuid,
          'proposal.expired',
          'proposal',
          ${r.id}::uuid,
          ${JSON.stringify({ proposalNumber: r.proposal_number, recipientName: r.recipient_name, leadId: r.lead_id })}::jsonb,
          ${JSON.stringify({ source: "expiry_worker" })}::jsonb
        )
      `);
    }

    return { expiredCount: expired.rows.length };
  });

  return NextResponse.json(out);
}
