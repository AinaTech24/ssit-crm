/**
 * Segment materializer.
 *
 * For each dynamic segment, runs the saved AST as a SQL query, diffs against
 * the current `segment_memberships`, and applies inserts/soft-removes.
 * Emits `segment_entry` and `segment_exit` events into the outbox so workflows
 * can react.
 */

import { and, eq, sql } from "drizzle-orm";
import { withTenant, withSystem } from "@/db/client";
import { eventsOutbox, segmentMemberships, segments } from "@/db/schema";
import { compileToSelect, bindCompiled } from "@/lib/filter/compiler";
import { captureError } from "@/lib/observability/capture";

/** Keep every multi-row statement well under Postgres' 65,535 bind-param cap. */
const WRITE_CHUNK = 1000;
const OUTBOX_CHUNK = 500;
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function materializeSegment(tenantId: string, segmentId: string): Promise<{
  added: number;
  removed: number;
  total: number;
  elapsedMs: number;
}> {
  const start = Date.now();

  return withTenant(tenantId, async (tx) => {
    // Bound each statement — a bad regex / deep relation EXISTS shouldn't pin a
    // worker connection. Generous (30s) since this is a background pass.
    await tx.execute(sql`SET LOCAL statement_timeout = '30000ms'`);
    const [seg] = await tx.select().from(segments).where(and(eq(segments.id, segmentId), eq(segments.tenantId, tenantId)));
    if (!seg) throw new Error(`Segment ${segmentId} not found`);
    if (seg.kind !== "dynamic") {
      throw new Error(`Cannot materialize static segment ${segmentId}`);
    }

    const ast = seg.ast as any;
    if (!ast) {
      return { added: 0, removed: 0, total: 0, elapsedMs: Date.now() - start };
    }

    const { sql: querySql, params } = compileToSelect(ast, seg.subjectType, {
      columns: [`${aliasOf(seg.subjectType)}.id`],
      limit: 100_000,
      tenantId,
    });

    const compiled = bindCompiled(querySql, params);
    const result = await tx.execute(compiled as any);
    const newIds = new Set((result.rows as any[]).map((r) => r.id));

    // Current memberships
    const currentRows = await tx
      .select()
      .from(segmentMemberships)
      .where(
        and(
          eq(segmentMemberships.segmentId, segmentId),
          eq(segmentMemberships.tenantId, tenantId),
          sql`${segmentMemberships.removedAt} IS NULL`
        )
      );
    const current = new Set(currentRows.map((r) => r.subjectId));

    const added: string[] = [];
    const removed: string[] = [];
    for (const id of newIds) {
      if (!current.has(id)) added.push(id);
    }
    for (const id of current) {
      if (!newIds.has(id)) removed.push(id);
    }

    // Apply changes — batched + CHUNKED. A single VALUES list of >~21K rows
    // (3 bind params each) or an IN (...) of >65K ids would exceed Postgres'
    // 65,535 bind-param ceiling and fail the whole materialization.
    for (const batch of chunk(added, WRITE_CHUNK)) {
      const valuesSql = sql.join(
        batch.map((id) => sql`(${segmentId}::uuid, ${tenantId}::uuid, ${id}::uuid, now(), NULL)`),
        sql`, `
      );
      await tx.execute(
        sql`INSERT INTO segment_memberships (segment_id, tenant_id, subject_id, added_at, removed_at)
            VALUES ${valuesSql}
            ON CONFLICT (segment_id, subject_id) DO UPDATE
            SET added_at = EXCLUDED.added_at, removed_at = NULL`
      );
    }
    for (const batch of chunk(removed, WRITE_CHUNK)) {
      const idList = sql.join(batch.map((id) => sql`${id}::uuid`), sql`, `);
      await tx.execute(
        sql`UPDATE segment_memberships SET removed_at = now()
            WHERE segment_id = ${segmentId}::uuid
              AND tenant_id = ${tenantId}::uuid
              AND subject_id IN (${idList})`
      );
    }

    // Emit entry/exit events — CHUNKED multi-row inserts, not one INSERT per id
    // (the old N+1 loop did up to 100K round-trips inside this transaction).
    for (const batch of chunk(added, OUTBOX_CHUNK)) {
      await tx.insert(eventsOutbox).values(
        batch.map((id) => ({
          tenantId,
          kind: `segment_entry.${seg.name}`,
          entityType: seg.subjectType,
          entityId: id,
          after: { segmentId, segmentName: seg.name },
        })) as any
      );
    }
    for (const batch of chunk(removed, OUTBOX_CHUNK)) {
      await tx.insert(eventsOutbox).values(
        batch.map((id) => ({
          tenantId,
          kind: `segment_exit.${seg.name}`,
          entityType: seg.subjectType,
          entityId: id,
          before: { segmentId, segmentName: seg.name },
        })) as any
      );
    }

    // Update segment counters
    const elapsed = Date.now() - start;
    await tx
      .update(segments)
      .set({
        memberCount: newIds.size,
        lastMaterializedAt: new Date(),
        lastMaterializationMs: elapsed,
      })
      .where(and(eq(segments.id, segmentId), eq(segments.tenantId, tenantId)));

    return { added: added.length, removed: removed.length, total: newIds.size, elapsedMs: elapsed };
  });
}

function aliasOf(subject: string): string {
  return { investor: "inv", lead: "ld", task: "tk", user: "usr" }[subject] ?? subject;
}

export function startSegmentMaterializerWorker() {
  // Default: scan every dynamic segment hourly. Per-segment cron overrides
  // will be supported via the master scheduler later.
  const interval = Number(process.env.SEGMENT_MATERIALIZER_INTERVAL_MS ?? 60_000);
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const rows = await withSystem(async (tx) => {
        return tx.execute(sql`
          SELECT id, tenant_id, last_materialized_at, refresh_cron
          FROM segments
          WHERE kind = 'dynamic' AND materializer_enabled = true
          ORDER BY last_materialized_at NULLS FIRST
          LIMIT 50
        `);
      });
      for (const r of rows.rows as any[]) {
        const last = r.last_materialized_at ? new Date(r.last_materialized_at) : null;
        if (last && Date.now() - last.getTime() < 30 * 60 * 1000) continue; // 30-min floor
        try {
          const out = await materializeSegment(r.tenant_id, r.id);
          console.log(`[seg] materialized ${r.id}: +${out.added} -${out.removed} total=${out.total}`);
        } catch (err) {
          captureError("[seg] segment materialization failed", err, { segmentId: r.id });
        }
      }
    } finally {
      running = false;
    }
  };
  const handle = setInterval(tick, interval);
  console.log(`[seg] materializer started (interval=${interval}ms)`);
  return () => clearInterval(handle);
}
