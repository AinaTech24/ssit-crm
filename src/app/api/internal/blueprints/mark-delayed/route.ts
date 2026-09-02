/**
 * POST /api/internal/blueprints/mark-delayed
 *
 * Periodic worker — flips `is_delayed=true` on lead_blueprint_instances
 * whose current stage SLA has elapsed, and emits an outbox event so the
 * escalation recipe (notify RM + owner) can fire.
 *
 * Auth: shared bearer token `INTERNAL_API_TOKEN`.
 *
 * Schedule: every 30 minutes via the master scheduler / cron.
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
    // Find instances whose current stage SLA has elapsed AND not already
    // flagged delayed. Cross-tenant scan.
    const newly = await tx.execute(sql`
      WITH due AS (
        SELECT lbi.id AS instance_id, lbi.tenant_id, lbi.lead_id, lbi.current_stage_key,
               bs.sla_days, bs.stage_name
        FROM lead_blueprint_instances lbi
        JOIN blueprint_stages bs
          ON bs.blueprint_id = lbi.blueprint_id
         AND bs.stage_key = lbi.current_stage_key
        WHERE lbi.status = 'in_progress'
          AND lbi.is_delayed = false
          AND bs.sla_days IS NOT NULL
          AND lbi.stage_entered_at + (bs.sla_days || ' days')::interval < now()
      )
      UPDATE lead_blueprint_instances l
        SET is_delayed = true,
            delayed_since = now(),
            updated_at = now()
        FROM due
       WHERE l.id = due.instance_id
       RETURNING l.id, l.tenant_id, l.lead_id, l.current_stage_key,
                 (SELECT stage_name FROM due WHERE due.instance_id = l.id) AS stage_name,
                 (SELECT sla_days   FROM due WHERE due.instance_id = l.id) AS sla_days
    `);

    // Emit outbox events for each newly-delayed lead
    for (const r of newly.rows as any[]) {
      await tx.execute(sql`
        INSERT INTO events_outbox (tenant_id, kind, entity_type, entity_id, after, meta)
        VALUES (
          ${r.tenant_id}::uuid,
          'blueprint.stage.delayed',
          'lead',
          ${r.lead_id}::uuid,
          ${JSON.stringify({ stageKey: r.current_stage_key, stageName: r.stage_name, slaDays: r.sla_days })}::jsonb,
          ${JSON.stringify({ source: "sla_worker" })}::jsonb
        )
      `);
    }

    return { delayedCount: newly.rows.length };
  });

  return NextResponse.json(out);
}
