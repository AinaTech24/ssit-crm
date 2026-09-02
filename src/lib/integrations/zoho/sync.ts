/**
 * Zoho sync engine (one-way: our CRM → Zoho).
 *
 * Self-contained poller: for each tenant with an active Zoho connection, it
 * reads the slice of `events_outbox` it hasn't pushed yet (its own cursor in
 * `zoho_sync_state`), maps each record, and upserts it to Zoho by external id.
 * It does NOT touch the shared outbox poller's `processed_at` — it tracks its
 * own position — so the two consumers never interfere.
 */
import { and, asc, eq, gt, inArray, or, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { withSystem } from "@/db/client";
import { eventsOutbox, tenantIntegrations, zohoSyncLinks, zohoSyncState } from "@/db/schema";
import { getZohoConnection, type ZohoConnection } from "./credentials";
import { mappingFor, SYNCED_ENTITY_TYPES, TABLE_MAPPINGS } from "./mapping";
import { upsertRecords, type ZohoUpsertResult } from "./client";

const BATCH = 200;
/** Per-module rows pushed per tick — Zoho upsert accepts at most 100 per call. */
const TABLE_BATCH = 100;

export async function runZohoSyncOnce(): Promise<{ tenants: number; pushed: number; failed: number }> {
  const tenantIds = await withSystem(async (tx) => {
    const rows = await tx
      .selectDistinct({ tenantId: tenantIntegrations.tenantId })
      .from(tenantIntegrations)
      .where(and(eq(tenantIntegrations.provider, "zoho"), eq(tenantIntegrations.isActive, true)));
    return rows.map((r) => r.tenantId);
  });

  let pushed = 0;
  let failed = 0;
  let active = 0;
  for (const tenantId of tenantIds) {
    try {
      const res = await syncTenant(tenantId);
      pushed += res.pushed;
      failed += res.failed;
      if (res.pushed || res.failed) active++;
    } catch (err) {
      console.error(`[zoho-sync] tenant ${tenantId} failed:`, (err as Error).message);
    }
  }
  return { tenants: active, pushed, failed };
}

async function syncTenant(tenantId: string): Promise<{ pushed: number; failed: number }> {
  return withSystem(async (tx) => {
    const conn = await getZohoConnection(tx, tenantId);
    if (!conn) return { pushed: 0, failed: 0 };

    let pushed = 0;
    let failed = 0;

    // ── 1. Outbox-driven modules (investor, lead) ──────────────────────────
    const cursor = await loadCursor(tx, tenantId); // also seeds the state row
    const events = await tx
      .select()
      .from(eventsOutbox)
      .where(
        and(
          eq(eventsOutbox.tenantId, tenantId),
          gt(eventsOutbox.id, BigInt(cursor)),
          inArray(eventsOutbox.entityType, SYNCED_ENTITY_TYPES),
          sql`${eventsOutbox.kind} NOT LIKE '%.deleted'`
        )
      )
      .orderBy(eventsOutbox.id)
      .limit(BATCH);

    if (events.length > 0) {
      // Collapse to the latest event per record so a rapidly-edited record is
      // pushed once per tick, not once per edit.
      const latest = new Map<string, (typeof events)[number]>();
      for (const ev of events) latest.set(`${ev.entityType}:${ev.entityId}`, ev);

      for (const ev of latest.values()) {
        const mapping = mappingFor(ev.entityType);
        const after = ev.after as Record<string, any> | null;
        if (!mapping || !after) continue;
        const entityId = String(ev.entityId);
        try {
          const [result] = await upsertRecords(conn, mapping.zohoModule, [mapping.toZoho(after)], mapping.externalIdField);
          await recordLink(tx, tenantId, ev.entityType, entityId, mapping.zohoModule, result);
          if (result?.ok) pushed++;
          else failed++;
        } catch (err) {
          failed++;
          await recordLink(tx, tenantId, ev.entityType, entityId, mapping.zohoModule, {
            externalIdValue: entityId,
            ok: false,
            error: (err as Error).message,
          });
        }
      }

      // Advance past the whole slice. Failures are recorded on the link rows
      // (status "error") for visibility + a future retry pass.
      const maxId = Number(events[events.length - 1].id);
      await tx.update(zohoSyncState).set({ lastOutboxId: maxId, updatedAt: new Date() }).where(eq(zohoSyncState.tenantId, tenantId));
    }

    // ── 2. Table-polled modules (tasks, meetings, insurance, sips, …) ──────
    const tableRes = await syncTableModules(tx, tenantId, conn);
    pushed += tableRes.pushed;
    failed += tableRes.failed;

    if (pushed || failed) console.log(`[zoho-sync] tenant ${tenantId}: pushed=${pushed} failed=${failed}`);
    return { pushed, failed };
  });
}

/**
 * Mirror the table-polled modules. For each module we track a per-tenant cursor
 * (`<updatedAt ISO>|<row id>`) in `zoho_sync_state.module_cursors` and push rows
 * whose (updatedAt, id) is past it — naturally covering both creates and edits
 * with no per-route instrumentation. On first sight we seed the cursor to "now"
 * (forward-only) so connecting an org never mass-backfills history into Zoho.
 */
async function syncTableModules(
  tx: Tx,
  tenantId: string,
  conn: ZohoConnection
): Promise<{ pushed: number; failed: number }> {
  const [state] = await tx.select().from(zohoSyncState).where(eq(zohoSyncState.tenantId, tenantId)).limit(1);
  const cursors: Record<string, string> = { ...((state?.moduleCursors as Record<string, string> | null) ?? {}) };
  let pushed = 0;
  let failed = 0;
  let changed = false;

  for (const m of TABLE_MAPPINGS) {
    const table = m.table;
    try {
      const cursorRaw = cursors[m.entityType];
      if (!cursorRaw) {
        // Forward-only seed — a full backfill is a separate, deliberate action.
        cursors[m.entityType] = `${new Date().toISOString()}|`;
        changed = true;
        continue;
      }

      const [cursorAtIso, cursorId] = cursorRaw.split("|");
      const cursorAt = new Date(cursorAtIso);
      const newer = cursorId
        ? or(gt(table.updatedAt, cursorAt), and(eq(table.updatedAt, cursorAt), sql`${table.id} > ${cursorId}::uuid`))!
        : gt(table.updatedAt, cursorAt);

      const rows: any[] = await tx
        .select()
        .from(table)
        .where(and(eq(table.tenantId, tenantId), newer))
        .orderBy(asc(table.updatedAt), asc(table.id))
        .limit(TABLE_BATCH);
      if (rows.length === 0) continue;

      const results = await upsertRecords(
        conn,
        m.zohoModule,
        rows.map((r) => m.toZoho(r)),
        m.externalIdField
      );
      for (let i = 0; i < rows.length; i++) {
        const entityId = String(rows[i].id);
        const result = results[i] ?? { externalIdValue: entityId, ok: false, error: "no result returned" };
        await recordLink(tx, tenantId, m.entityType, entityId, m.zohoModule, result);
        if (result.ok) pushed++;
        else failed++;
      }

      const last = rows[rows.length - 1];
      cursors[m.entityType] = `${new Date(last.updatedAt).toISOString()}|${String(last.id)}`;
      changed = true;
    } catch (err) {
      // One module failing (e.g. a missing custom Zoho module) must not abort
      // the rest. Leave its cursor unadvanced so it retries next tick.
      console.error(`[zoho-sync] table module ${m.entityType} failed:`, (err as Error).message);
    }
  }

  if (changed) {
    await tx
      .update(zohoSyncState)
      .set({ moduleCursors: cursors as any, updatedAt: new Date() })
      .where(eq(zohoSyncState.tenantId, tenantId));
  }
  return { pushed, failed };
}

/**
 * Load (or seed) the per-tenant cursor. On first connect we seed it to the
 * CURRENT max outbox id so we sync changes going forward — a full backfill of
 * existing records is a separate, deliberate action (Phase 2).
 */
async function loadCursor(tx: Tx, tenantId: string): Promise<number> {
  const [state] = await tx.select().from(zohoSyncState).where(eq(zohoSyncState.tenantId, tenantId)).limit(1);
  if (state) return Number(state.lastOutboxId ?? 0);
  const [{ maxId } = { maxId: 0 }] = await tx
    .select({ maxId: sql<number>`COALESCE(MAX(${eventsOutbox.id}), 0)` })
    .from(eventsOutbox)
    .where(eq(eventsOutbox.tenantId, tenantId));
  const start = Number(maxId) || 0;
  await tx.insert(zohoSyncState).values({ tenantId, lastOutboxId: start } as any).onConflictDoNothing();
  return start;
}

async function recordLink(
  tx: Tx,
  tenantId: string,
  entityType: string,
  entityId: string,
  zohoModule: string,
  result: ZohoUpsertResult
): Promise<void> {
  const set = {
    status: result.ok ? ("synced" as const) : ("error" as const),
    zohoId: result.zohoId ?? undefined,
    lastError: result.ok ? null : result.error ?? "unknown",
    lastSyncedAt: result.ok ? new Date() : undefined,
    updatedAt: new Date(),
  };
  const [existing] = await tx
    .select({ id: zohoSyncLinks.id })
    .from(zohoSyncLinks)
    .where(and(eq(zohoSyncLinks.tenantId, tenantId), eq(zohoSyncLinks.entityType, entityType), eq(zohoSyncLinks.entityId, entityId)))
    .limit(1);
  if (existing) {
    await tx.update(zohoSyncLinks).set(set).where(eq(zohoSyncLinks.id, existing.id));
  } else {
    await tx.insert(zohoSyncLinks).values({ tenantId, entityType, entityId, zohoModule, ...set } as any);
  }
}
