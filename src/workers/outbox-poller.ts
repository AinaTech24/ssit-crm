/**
 * Outbox poller — the heart of event-driven triggers.
 *
 * Reads unprocessed rows from `events_outbox` (using FOR UPDATE SKIP LOCKED
 * for concurrency safety), matches them against active workflow triggers
 * (kind='record_event' or 'inbound_message' or 'communication_event'),
 * and enqueues new workflow runs.
 *
 * Also handles `wait_for_event` parked runs — finds runs whose
 * `wait_predicate.eventKind` matches and whose `wait_predicate.criteria`
 * evaluates true against the event payload, and resumes them.
 */

import { Worker } from "bullmq";
import { and, eq, isNull, lte, or, sql } from "drizzle-orm";
import { withSystem, withTenant } from "@/db/client";
import { eventsOutbox, workflowRuns, workflowTriggers, workflows } from "@/db/schema";
import { startRun } from "@/lib/workflow/runner";
import { compileToPredicate } from "@/lib/filter/predicate";
import { Q, getConnection } from "./queues";
import { runRulesForEvent, cancelScheduledJobsForSubject } from "@/lib/workflow-rules/runner";
import { MODULES } from "@/lib/workflow-rules/modules";
import { handleBlueprintStageEvent } from "@/lib/blueprints/event-consumers";
import { captureError } from "@/lib/observability/capture";

const BATCH_SIZE = 200;
/** After this many failed attempts an event is dead-lettered: it stays in the
 *  table (processed_at NULL, attempts >= cap) but is never claimed again, so a
 *  poison event can't burn a retry slot forever. Ops query:
 *  SELECT * FROM events_outbox WHERE processed_at IS NULL AND attempts >= 8. */
const MAX_ATTEMPTS = 8;

export async function pollOutboxOnce(): Promise<{ processed: number; errors: number }> {
  let processed = 0;
  let errors = 0;

  // System-context read with SKIP LOCKED to claim rows across multiple workers.
  //
  // The `claimed_at` guard prevents DOUBLE-PROCESSING: once a worker claims a
  // batch it commits (releasing the row lock) and processes each event in
  // separate transactions. Without the guard, a second poller's next tick
  // would re-find the same still-unprocessed rows (processed_at IS NULL) and
  // re-claim them while the first worker is mid-flight. We therefore only
  // claim rows that are UNCLAIMED or whose claim is STALE (older than the
  // visibility timeout — the original worker almost certainly died), which
  // preserves crash-recovery while eliminating the in-flight race.
  const claimed = await withSystem(async (tx) => {
    const rows = await tx.execute(sql`
      WITH cte AS (
        SELECT id FROM events_outbox
        WHERE processed_at IS NULL
          AND COALESCE(attempts, 0) < ${MAX_ATTEMPTS}
          AND (claimed_at IS NULL OR claimed_at < now() - interval '5 minutes')
        ORDER BY id
        LIMIT ${BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE events_outbox e
      SET claimed_at = now()
      FROM cte
      WHERE e.id = cte.id
      RETURNING e.*;
    `);
    return rows.rows as any[];
  });

  for (const event of claimed) {
    try {
      await processEvent(event);
      await withSystem(async (tx) => {
        await tx.execute(sql`UPDATE events_outbox SET processed_at = now() WHERE id = ${event.id}`);
      });
      processed++;
    } catch (err) {
      errors++;
      const msg = (err as Error).message;
      const updated = await withSystem(async (tx) => {
        // `attempts` is integer (migration 0016); SET … = attempts + 1 is
        // atomic now so concurrent retries can't race past each other.
        const r = await tx.execute(
          sql`UPDATE events_outbox
              SET attempts = COALESCE(attempts, 0) + 1,
                  last_error = ${msg},
                  claimed_at = NULL
              WHERE id = ${event.id}
              RETURNING attempts`
        );
        return (r.rows as any[])[0];
      });
      const attempts = Number(updated?.attempts ?? 0);
      if (attempts >= MAX_ATTEMPTS) {
        // Crossed the dead-letter threshold — it will never be claimed again.
        captureError("[outbox] event dead-lettered", err, {
          eventId: event.id,
          kind: event.kind,
          tenantId: event.tenant_id,
          attempts,
        });
      } else {
        console.error(`[outbox] event ${event.id} failed (attempt ${attempts}/${MAX_ATTEMPTS}):`, msg);
      }
    }
  }

  return { processed, errors };
}

async function processEvent(event: any) {
  const tenantId: string = event.tenant_id;

  // 0) Blueprint lifecycle events (stage enter/exit → run recipe; stage delayed
  //    → owner task). These are internal engine events; no generic workflow
  //    trigger or Zoho rule subscribes to them, so handle + return early.
  if (typeof event.kind === "string" && event.kind.startsWith("blueprint.stage.")) {
    await handleBlueprintStageEvent(event);
    return;
  }

  // 1) Find subscribed workflow triggers
  const triggers = await withTenant(tenantId, async (tx) => {
    return tx
      .select()
      .from(workflowTriggers)
      .where(
        and(
          eq(workflowTriggers.enabled, true),
          // record_event triggers carry their kind filter in config.eventKind
          // or in config.eventPrefix (for prefix matching)
          or(
            eq(workflowTriggers.kind, "record_event"),
            eq(workflowTriggers.kind, "inbound_message"),
            eq(workflowTriggers.kind, "communication_event"),
            eq(workflowTriggers.kind, "segment_entry"),
            eq(workflowTriggers.kind, "segment_exit")
          )
        )
      );
  });

  for (const trig of triggers) {
    const cfg = trig.config as any;
    const triggerKinds: string[] = cfg.eventKinds ?? (cfg.eventKind ? [cfg.eventKind] : []);
    if (!triggerKinds.includes(event.kind)) {
      // try prefix match
      const prefixes: string[] = cfg.eventPrefixes ?? [];
      if (!prefixes.some((p) => event.kind.startsWith(p))) continue;
    }

    // Optional criteria match against event payload
    if (trig.criteria) {
      try {
        const pred = compileToPredicate(trig.criteria as any, cfg.subjectType ?? "investor");
        if (!pred({ ...event.after, ...event.meta, event })) continue;
      } catch (err) {
        console.warn(`[outbox] criteria eval failed for trigger ${trig.id}:`, (err as Error).message);
        continue;
      }
    }

    await startRun({
      tenantId,
      workflowId: trig.workflowId,
      triggeredBy: "event",
      triggerId: trig.id,
      subjectType: cfg.subjectType ?? event.entity_type,
      subjectId: cfg.subjectIdFrom === "event.entity_id" ? event.entity_id : event.entity_id,
      // correlationId = the outbox event id — lets one client journey be traced
      // across outbox → run → steps → comms in logs and captureError alerts.
      contextSnapshot: { before: event.before, after: event.after, meta: event.meta, kind: event.kind, correlationId: event.id },
      event: event,
    });
  }

  // 2) Resume parked wait_for_event runs
  await resumeWaitingRuns(tenantId, event);

  // 3) Run Zoho-style Workflow Rules
  const matchedModule = Object.values(MODULES).find(
    (m) =>
      m.actionEvents.create === event.kind ||
      m.actionEvents.edit === event.kind ||
      m.actionEvents.delete === event.kind
  );
  if (matchedModule) {
    const recordAction =
      event.kind === matchedModule.actionEvents.create
        ? "create"
        : event.kind === matchedModule.actionEvents.edit
          ? "edit"
          : "delete";

    if (recordAction === "delete") {
      try {
        await cancelScheduledJobsForSubject(tenantId, matchedModule.entityType, event.entity_id, "Subject deleted");
      } catch (err) {
        console.error(`[outbox] Cancel scheduled jobs failed for deleted subject ${event.entity_id}:`, (err as Error).message);
      }
    } else {
      try {
        const results = await runRulesForEvent({
          tenantId,
          module: matchedModule.key,
          recordAction,
          subjectType: matchedModule.entityType,
          subjectId: event.entity_id,
          before: event.before,
          after: event.after,
          eventId: event.id,
        });
        const matchedCount = results.filter((r) => r.matched).length;
        if (matchedCount > 0) {
          console.log(`[outbox] Workflow rules triggered for event ${event.id}: matched=${matchedCount}`);
        }
      } catch (err) {
        console.error(`[outbox] Workflow rules run failed for event ${event.id}:`, (err as Error).message);
      }
    }
  }
}

async function resumeWaitingRuns(tenantId: string, event: any) {
  // Find paused runs whose wait_predicate.eventKind matches
  const runs = await withTenant(tenantId, async (tx) => {
    return tx.execute(sql`
      SELECT * FROM workflow_runs
      WHERE tenant_id = ${tenantId}
        AND status = 'paused'
        AND wait_predicate->>'eventKind' = ${event.kind}
    `);
  });

  for (const r of runs.rows as any[]) {
    // Criteria check
    const criteria = r.wait_predicate?.criteria;
    if (criteria) {
      try {
        const pred = compileToPredicate(criteria, r.subject_type ?? "investor");
        if (!pred({ ...event.after, ...event.meta, event })) continue;
      } catch {
        continue;
      }
    }
    // Re-queue
    await withTenant(tenantId, async (tx) => {
      await tx.execute(sql`
        UPDATE workflow_runs
        SET status = 'queued',
            paused_until = NULL,
            wait_predicate = NULL
        WHERE id = ${r.id}
      `);
    });
  }
}

export function startOutboxPollerWorker() {
  // Single processor that runs on a tight interval
  const intervalMs = Number(process.env.OUTBOX_POLLER_INTERVAL_MS ?? "200");
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const { processed, errors } = await pollOutboxOnce();
      if (processed > 0 || errors > 0) {
        console.log(`[outbox] processed=${processed} errors=${errors}`);
      }
    } catch (err) {
      captureError("[outbox] tick error", err);
    } finally {
      running = false;
    }
  };
  const handle = setInterval(tick, intervalMs);
  console.log(`[outbox] poller started (interval=${intervalMs}ms)`);
  return () => clearInterval(handle);
}
