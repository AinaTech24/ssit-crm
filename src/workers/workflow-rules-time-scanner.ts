/**
 * Workflow Rules Time Scanner — fires the two time-based rule trigger types
 * that have no outbox event to piggyback on:
 *
 *   date_field  — "N days/weeks/months before|on|after <date field>, at HH:mm"
 *                 (optionally recurring every month / every year, e.g. birthdays,
 *                 KYC expiry, policy renewals)
 *   recurrence  — classic 5-field cron ("0 9 * * 1" = every Monday 09:00),
 *                 applied to every record of the module that matches the rule's
 *                 criteria at fire time
 *
 * Idempotency: every firing claims a workflow_rule_executions row through the
 * (rule_id, trigger_event_id) unique index with a synthetic event id —
 * `date:<recordId>:<yyyy-mm-dd>` / `cron:<recordId>:<tick>` — so re-scans,
 * restarts and overlapping ticks can never double-send.
 *
 * All times are interpreted in IST (Asia/Kolkata) — this is an India-only
 * product and Zoho fires workflows in the org's timezone.
 */

import { sql } from "drizzle-orm";
import { withSystem, withTenant } from "@/db/client";
import { workflowRules } from "@/db/schema";
import { getModule, getField } from "@/lib/workflow-rules/modules";
import { fireRuleOnRecordTx } from "@/lib/workflow-rules/runner";
import { inArray, eq, and } from "drizzle-orm";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
/** Per-rule per-scan record cap — keeps a runaway rule from flooding sends. */
const MAX_RECORDS_PER_RULE = 500;
/** How far back each scan looks for missed cron ticks (covers restarts). */
const CRON_LOOKBACK_MIN = 10;

/** IST "wall clock": shift the instant, then read with getUTC* getters. */
function istClock(d = new Date()): Date {
  return new Date(d.getTime() + IST_OFFSET_MS);
}
function istDateStr(clock: Date): string {
  const y = clock.getUTCFullYear();
  const m = String(clock.getUTCMonth() + 1).padStart(2, "0");
  const day = String(clock.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function runWorkflowRulesTimeScanOnce(): Promise<{ fired: number; scanned: number }> {
  const rules = await withSystem(async (tx) =>
    tx
      .select()
      .from(workflowRules)
      .where(and(inArray(workflowRules.triggerType, ["date_field", "recurrence"]), eq(workflowRules.enabled, true)))
  );

  let fired = 0;
  for (const rule of rules as any[]) {
    try {
      if (rule.triggerType === "date_field") fired += await scanDateRule(rule);
      else fired += await scanRecurrenceRule(rule);
    } catch (err) {
      console.error(`[rules-time] rule ${rule.id} (${rule.name}) scan failed:`, (err as Error).message);
    }
  }
  return { fired, scanned: rules.length };
}

// ---------------------------------------------------------------------------
// date_field rules
// ---------------------------------------------------------------------------

async function scanDateRule(rule: any): Promise<number> {
  const cfg = (rule.triggerConfig ?? {}) as {
    field?: string;
    when?: "before" | "on" | "after";
    offset?: number;
    unit?: "day" | "week" | "month";
    recurrence?: "once" | "every_month" | "every_year";
    time?: string;
  };
  const mod = getModule(rule.module);
  const fieldDef = cfg.field ? getField(rule.module, cfg.field) : undefined;
  // Whitelist the anchor column against the catalog — config is tenant-supplied,
  // so never interpolate it into SQL unless it's a known dateAnchor field.
  if (!mod || !fieldDef?.dateAnchor) return 0;
  // The REAL DB column may differ from the catalog key (e.g. "last_activity_at"
  // is backed by the table's `updated_at`). Guard against any non-identifier.
  const colName = String((fieldDef as any).column ?? cfg.field);
  if (!/^[a-z_][a-z0-9_]*$/i.test(colName)) {
    console.warn(`[rules-time] rule "${rule.name}": invalid anchor column "${colName}" — skipped`);
    return 0;
  }

  const nowClock = istClock();

  // Time-of-day gate (IST). Default 09:00 like Zoho.
  const [hh, mm] = (cfg.time ?? "09:00").split(":").map(Number);
  const minutesNow = nowClock.getUTCHours() * 60 + nowClock.getUTCMinutes();
  if (minutesNow < hh * 60 + mm) return 0;

  // The rule fires TODAY for records whose anchor date is `today + offset`
  // (before), `today - offset` (after), or `today` (on).
  const target = new Date(nowClock.getTime());
  const sign = cfg.when === "before" ? 1 : cfg.when === "after" ? -1 : 0;
  const offset = Math.max(0, Number(cfg.offset ?? 0));
  if (sign !== 0 && offset > 0) {
    if (cfg.unit === "month") target.setUTCMonth(target.getUTCMonth() + sign * offset);
    else target.setUTCDate(target.getUTCDate() + sign * offset * (cfg.unit === "week" ? 7 : 1));
  }
  const targetStr = istDateStr(target);
  const todayStr = istDateStr(nowClock);

  // Anchor expressed as an IST calendar date (timestamps shift via AT TIME ZONE).
  const col = sql.raw(`"${colName}"`);
  const dateExpr =
    fieldDef.type === "datetime"
      ? sql`((${col} AT TIME ZONE 'Asia/Kolkata')::date)`
      : sql`(${col}::date)`;

  const condition =
    cfg.recurrence === "every_year"
      ? sql`to_char(${dateExpr}, 'MM-DD') = to_char(${targetStr}::date, 'MM-DD')`
      : cfg.recurrence === "every_month"
        ? sql`EXTRACT(DAY FROM ${dateExpr}) = EXTRACT(DAY FROM ${targetStr}::date)`
        : sql`${dateExpr} = ${targetStr}::date`;

  return withTenant(rule.tenantId, async (tx) => {
    const res = await tx.execute(sql`
      SELECT * FROM ${sql.raw(`"${mod.table}"`)}
      WHERE tenant_id = ${rule.tenantId}::uuid
        AND ${col} IS NOT NULL
        AND ${condition}
      LIMIT ${MAX_RECORDS_PER_RULE + 1}
    `);
    const rows = res.rows as Array<Record<string, unknown>>;
    if (rows.length > MAX_RECORDS_PER_RULE) {
      console.warn(`[rules-time] rule ${rule.name}: hit ${MAX_RECORDS_PER_RULE}-record cap — remainder fires on the next scan day`);
    }

    let fired = 0;
    for (const row of rows.slice(0, MAX_RECORDS_PER_RULE)) {
      if (!row.id) continue;
      const result = await fireRuleOnRecordTx(tx, rule, {
        subjectType: mod.entityType,
        subjectId: String(row.id),
        record: row,
        eventId: `date:${row.id}:${todayStr}`,
        triggeredBy: "schedule",
      });
      if (result.matched) fired++;
    }
    if (fired > 0) console.log(`[rules-time] date rule "${rule.name}" fired for ${fired} record(s)`);
    return fired;
  });
}

// ---------------------------------------------------------------------------
// recurrence (cron) rules
// ---------------------------------------------------------------------------

async function scanRecurrenceRule(rule: any): Promise<number> {
  const cfg = (rule.triggerConfig ?? {}) as { cron?: string };
  const mod = getModule(rule.module);
  if (!mod || !cfg.cron) return 0;

  // Find the most recent IST minute in the lookback window that matches the
  // cron. Only the latest match fires (an every-minute cron fires once per
  // scan, not once per minute of lookback); the synthetic event id keeps
  // overlapping windows idempotent anyway.
  const now = new Date();
  let tick: Date | null = null;
  for (let back = 0; back <= CRON_LOOKBACK_MIN; back++) {
    const candidate = new Date(now.getTime() - back * 60_000);
    if (cronMatches(cfg.cron, istClock(candidate))) {
      tick = candidate;
      break;
    }
  }
  if (!tick) return 0;
  const tickId = `${istDateStr(istClock(tick))}T${String(istClock(tick).getUTCHours()).padStart(2, "0")}:${String(istClock(tick).getUTCMinutes()).padStart(2, "0")}`;

  return withTenant(rule.tenantId, async (tx) => {
    const res = await tx.execute(sql`
      SELECT * FROM ${sql.raw(`"${mod.table}"`)}
      WHERE tenant_id = ${rule.tenantId}::uuid
      ORDER BY created_at DESC
      LIMIT ${MAX_RECORDS_PER_RULE + 1}
    `);
    const rows = res.rows as Array<Record<string, unknown>>;
    if (rows.length > MAX_RECORDS_PER_RULE) {
      console.warn(`[rules-time] cron rule "${rule.name}": module has >${MAX_RECORDS_PER_RULE} records — only the newest ${MAX_RECORDS_PER_RULE} are evaluated each tick`);
    }

    let fired = 0;
    for (const row of rows.slice(0, MAX_RECORDS_PER_RULE)) {
      if (!row.id) continue;
      // Branch criteria filter happens inside the runner — non-matching
      // records are skipped without an execution row.
      const result = await fireRuleOnRecordTx(tx, rule, {
        subjectType: mod.entityType,
        subjectId: String(row.id),
        record: row,
        eventId: `cron:${row.id}:${tickId}`,
        triggeredBy: "schedule",
      });
      if (result.matched) fired++;
    }
    if (fired > 0) console.log(`[rules-time] cron rule "${rule.name}" tick ${tickId} fired for ${fired} record(s)`);
    return fired;
  });
}

// ---------------------------------------------------------------------------
// Minimal 5-field cron matcher: "min hour dom mon dow" with * , - / lists.
// dow accepts 0-7 (0 and 7 = Sunday). Evaluated against the IST wall clock.
// ---------------------------------------------------------------------------

export function cronMatches(expr: string, clock: Date): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [min, hour, dom, mon, dow] = parts;
  const day = clock.getUTCDay();
  return (
    matchCronField(min, clock.getUTCMinutes(), 0, 59) &&
    matchCronField(hour, clock.getUTCHours(), 0, 23) &&
    matchCronField(dom, clock.getUTCDate(), 1, 31) &&
    matchCronField(mon, clock.getUTCMonth() + 1, 1, 12) &&
    (matchCronField(dow, day, 0, 7) || (day === 0 && matchCronField(dow, 7, 0, 7)))
  );
}

function matchCronField(spec: string, value: number, lo: number, hi: number): boolean {
  return spec.split(",").some((partRaw) => {
    let part = partRaw.trim();
    let step = 1;
    const slash = part.split("/");
    if (slash.length === 2) {
      step = Number(slash[1]);
      part = slash[0];
    }
    if (!Number.isFinite(step) || step < 1) return false;
    let start = lo;
    let end = hi;
    if (part !== "*") {
      const range = part.split("-");
      if (range.length === 2) {
        start = Number(range[0]);
        end = Number(range[1]);
      } else {
        start = Number(part);
        end = slash.length === 2 ? hi : start; // "a/n" = every n starting at a
      }
      if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
    }
    if (value < start || value > end) return false;
    return (value - start) % step === 0;
  });
}

// ---------------------------------------------------------------------------
// Worker loop
// ---------------------------------------------------------------------------

export function startWorkflowRulesTimeScannerWorker() {
  const interval = Number(process.env.WORKFLOW_RULES_TIME_SCAN_INTERVAL_MS ?? 60_000);
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const { fired, scanned } = await runWorkflowRulesTimeScanOnce();
      if (fired > 0) console.log(`[rules-time] scanned=${scanned} fired=${fired}`);
    } catch (err) {
      console.error("[rules-time] tick error:", (err as Error).message);
    } finally {
      running = false;
    }
  };
  void tick();
  const t = setInterval(tick, interval);
  t.unref?.();
  console.log(`[rules-time] time-based rule scanner started (every ${Math.round(interval / 1000)}s)`);
  return () => clearInterval(t);
}
