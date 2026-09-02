import { sql } from "drizzle-orm";
import { withSystem } from "@/db/client";
import { createNotification } from "@/lib/notifications/create";

/**
 * Sweeps active Lead and Polymorphic Blueprint instances,
 * flags them as delayed (is_delayed = true) on SLA breach,
 * and fires outbox events.
 */
export async function checkBlueprintSLADelays(): Promise<{
  leadsDelayed: number;
  polyDelayed: number;
}> {
  return await withSystem(async (tx) => {
    // 1. Sweep lead_blueprint_instances (Leads)
    const newlyDelayedLeads = await tx.execute(sql`
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
                 due.stage_name, due.sla_days
    `);

    // Emit outbox events + notify the owner (and escalate untouched leads) for
    // each newly-delayed lead, so an SLA breach is actually seen — not just a
    // silent `is_delayed` flag. Fires once per breach (the WHERE is_delayed=false
    // guard above means a lead is swept here only on the transition into delayed).
    for (const r of newlyDelayedLeads.rows as any[]) {
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

      try {
        const lr = await tx.execute(
          sql`SELECT owner_id, name, lead_score, score_band FROM leads WHERE id = ${r.lead_id}::uuid AND tenant_id = ${r.tenant_id}::uuid LIMIT 1`
        );
        const lead = lr.rows[0] as { owner_id?: string; name?: string; lead_score?: number; score_band?: string } | undefined;
        const untouched = r.current_stage_key === "new"; // never first-contacted
        // Hot lead = a high deterministic score / "hot" band. An untouched HOT
        // lead is the costliest miss, so it escalates harder (critical + 🔥).
        const hot = (lead?.score_band === "hot") || Number(lead?.lead_score ?? 0) >= 70;
        const recipients = new Set<string>();
        if (lead?.owner_id) recipients.add(lead.owner_id);
        // Untouched leads past their first-response SLA are the highest-risk —
        // escalate to the firm's managers so it's not just on the owner.
        if (untouched) {
          const mgrs = await tx.execute(
            sql`SELECT id FROM users WHERE tenant_id = ${r.tenant_id}::uuid AND roles && ARRAY['owner','branch_head']::text[]`
          );
          for (const m of mgrs.rows as any[]) recipients.add(m.id as string);
        }
        const name = lead?.name ?? "lead";
        const title = untouched
          ? `${hot ? "🔥 Hot lead untouched" : "Untouched lead"}: ${name}`
          : `Lead overdue: ${name}`;
        const severity = untouched ? (hot ? "critical" : "warning") : "info";
        for (const userId of recipients) {
          await createNotification(tx, {
            tenantId: r.tenant_id,
            userId,
            kind: "blueprint.stage.delayed",
            title,
            body: `Stuck in "${r.stage_name}" past the ${r.sla_days}-day SLA — follow up to keep it moving.`,
            linkUrl: `/dashboard/leads/${r.lead_id}`,
            severity,
            meta: { lead_id: r.lead_id, stage: r.current_stage_key, sla_days: r.sla_days, hot, source: "sla_worker" },
          });
        }
      } catch {
        // Notification is best-effort — never fail the SLA sweep over a notify.
      }
    }

    // 2. Sweep blueprint_instances (Polymorphic subjects)
    const newlyDelayedPoly = await tx.execute(sql`
      WITH due AS (
        SELECT bi.id AS instance_id, bi.tenant_id, bi.subject_type, bi.subject_id, bi.current_stage_key,
               bs.sla_days, bs.stage_name
        FROM blueprint_instances bi
        JOIN blueprint_stages bs
          ON bs.blueprint_id = bi.blueprint_id
         AND bs.stage_key = bi.current_stage_key
        WHERE bi.status = 'in_progress'
          AND bi.is_delayed = false
          AND bs.sla_days IS NOT NULL
          AND bi.stage_entered_at + (bs.sla_days || ' days')::interval < now()
      )
      UPDATE blueprint_instances b
        SET is_delayed = true,
            delayed_since = now(),
            updated_at = now()
        FROM due
       WHERE b.id = due.instance_id
       RETURNING b.id, b.tenant_id, b.subject_type, b.subject_id, b.current_stage_key,
                 due.stage_name, due.sla_days
    `);

    // Emit outbox events for each newly-delayed polymorphic instance
    for (const r of newlyDelayedPoly.rows as any[]) {
      await tx.execute(sql`
        INSERT INTO events_outbox (tenant_id, kind, entity_type, entity_id, after, meta)
        VALUES (
          ${r.tenant_id}::uuid,
          'blueprint.stage.delayed',
          ${r.subject_type},
          ${r.subject_id}::uuid,
          ${JSON.stringify({ stageKey: r.current_stage_key, stageName: r.stage_name, slaDays: r.sla_days })}::jsonb,
          ${JSON.stringify({ source: "sla_worker" })}::jsonb
        )
      `);
    }

    return {
      leadsDelayed: newlyDelayedLeads.rows.length,
      polyDelayed: newlyDelayedPoly.rows.length,
    };
  });
}

/**
 * Starts the blueprint SLA worker poller.
 */
export function startBlueprintSLAWorker(): () => void {
  const interval = Number(process.env.BLUEPRINT_SLA_INTERVAL_MS ?? 300_000); // 5 minutes default
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const results = await checkBlueprintSLADelays();
      if (results.leadsDelayed > 0 || results.polyDelayed > 0) {
        console.log(
          `[blueprint-sla-worker] swept: leadsDelayed=${results.leadsDelayed} polyDelayed=${results.polyDelayed}`
        );
      }
    } catch (err) {
      console.error("[blueprint-sla-worker] sweep failed:", (err as Error).message);
    } finally {
      running = false;
    }
  };

  const handle = setInterval(tick, interval);
  console.log(`[blueprint-sla-worker] started (interval=${interval}ms)`);
  return () => clearInterval(handle);
}
