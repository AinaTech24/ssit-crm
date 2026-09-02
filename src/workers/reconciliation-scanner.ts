/**
 * Reconciliation scanner — turns ingested RTA/CAS transaction data into
 * automation *events*, hands-off, on a schedule.
 *
 * The gap it closes: RTA file ingestion (processRtaFile) writes
 * transactions / sip_rejections rows but never emits into events_outbox, so
 * a real redemption or SIP bounce from the daily feed never *fires* the
 * recipes that should chase it. This worker scans recently-ingested
 * transactions and emits the matching events so the engine reacts to real
 * money movement automatically.
 *
 * Events emitted (consumed by recipes via workflow_triggers):
 *   transaction.failed.sip_rejection  — SIP installment rejected/failed
 *   transaction.redemption            — redemption / SWP processed
 *
 * The event `after` payload uses snake_case keys (reason_code, scheme_name,
 * amount, order_date) so the existing recipes — which read
 * `event.reason_code`, `event.amount`, etc. — bind without changes.
 *
 * Idempotency: each event carries meta.txId = the source transaction id, and
 * every INSERT is guarded by `NOT EXISTS (… meta->>'txId' = t.id)`. A
 * transaction therefore fires its event exactly once, ever — re-runs and
 * widened windows are safe no-ops at the write layer.
 *
 * Schedule: a self-scheduled daily tick at 07:30 local (after the 07:00 NAV
 * refresh, so valuations are fresh). First run processes the trailing 2 days;
 * pass `sinceDays` to widen (used by tests / back-fills).
 */

import { sql } from "drizzle-orm";
import { withSystem, withTenant } from "@/db/client";

export interface ReconResult {
  tenantId: string;
  sipRejectionEvents: number;
  redemptionEvents: number;
  /** New sip_rejections recovery rows created from transaction-feed bounces. */
  sipRejectionRows: number;
  /** SIP rejections that breached the 2-day SLA and were escalated this run. */
  slaEscalations: number;
  aumDriftCount: number;
  durationMs: number;
}

async function listActiveTenants(): Promise<string[]> {
  return await withSystem(async (tx) => {
    const r = await tx.execute(sql`
      SELECT id FROM tenants WHERE status IN ('active', 'trial')
    `);
    return (r.rows as Array<{ id: string }>).map((row) => row.id);
  });
}

export async function reconcileTenant(
  tenantId: string,
  opts: { sinceDays?: number } = {}
): Promise<ReconResult> {
  const startedAt = Date.now();
  // Clamp the look-back to [1, 3650] days. Default cadence is "since yesterday".
  const days = Math.max(1, Math.min(3650, Math.floor(opts.sinceDays ?? 2)));
  const since = sql.raw(`${days} days`);

  const result: ReconResult = {
    tenantId,
    sipRejectionEvents: 0,
    redemptionEvents: 0,
    sipRejectionRows: 0,
    slaEscalations: 0,
    aumDriftCount: 0,
    durationMs: 0,
  };

  await withTenant(
    tenantId,
    async (tx) => {
      // ── 1. SIP rejections → transaction.failed.sip_rejection ──────────
      const sipRes = await tx.execute(sql`
        INSERT INTO events_outbox (tenant_id, kind, entity_type, entity_id, after, meta)
        SELECT t.tenant_id, 'transaction.failed.sip_rejection', 'investor', t.investor_id,
          jsonb_build_object(
            'tx_id', t.id,
            'reason_code', t.reason_code,
            'reason', t.reason_description,
            'scheme_name', t.scheme_name,
            'amount', t.amount,
            'order_date', t.order_date,
            'name', i.name
          ),
          jsonb_build_object('source', 'reconciliation-scanner', 'txId', t.id::text)
        FROM transactions t
        JOIN investors i ON i.id = t.investor_id
        WHERE t.type = 'sip'
          AND t.status IN ('rejected', 'failed')
          AND t.created_at >= now() - interval '${since}'
          AND NOT EXISTS (
            SELECT 1 FROM events_outbox e
            WHERE e.tenant_id = t.tenant_id
              AND e.kind = 'transaction.failed.sip_rejection'
              AND e.meta->>'txId' = t.id::text
          )
        RETURNING 1
      `);
      result.sipRejectionEvents = sipRes.rows.length;

      // ── 2. Redemptions / SWP → transaction.redemption ─────────────────
      const redRes = await tx.execute(sql`
        INSERT INTO events_outbox (tenant_id, kind, entity_type, entity_id, after, meta)
        SELECT t.tenant_id, 'transaction.redemption', 'investor', t.investor_id,
          jsonb_build_object(
            'tx_id', t.id,
            'type', t.type,
            'scheme_name', t.scheme_name,
            'amount', t.amount,
            'order_date', t.order_date,
            'name', i.name
          ),
          jsonb_build_object('source', 'reconciliation-scanner', 'txId', t.id::text)
        FROM transactions t
        JOIN investors i ON i.id = t.investor_id
        WHERE t.type IN ('redemption', 'swp')
          AND t.status IN ('processed', 'successful')
          AND t.created_at >= now() - interval '${since}'
          AND NOT EXISTS (
            SELECT 1 FROM events_outbox e
            WHERE e.tenant_id = t.tenant_id
              AND e.kind = 'transaction.redemption'
              AND e.meta->>'txId' = t.id::text
          )
        RETURNING 1
      `);
      result.redemptionEvents = redRes.rows.length;

      // ── 2b. Feed coverage — materialise a recovery row for every SIP bounce ──
      // A SIP bounce arriving via the daily transaction feed (status=rejected)
      // fires the workflow event above, but historically never created a
      // sip_rejections recovery row — only the dedicated rejection-report file or
      // a manual entry did. So the recovery pipeline silently under-counted.
      // Here we upsert a tracker row (with RM owner, 2-day follow-up and reason
      // category) for each transaction-feed bounce. We do NOT create a task —
      // the event above already drives the recipe; this is the tracking record.
      //
      // Dedup: skip if a row already exists for this transaction (re-runs) OR for
      // the same (investor, date, amount) — which catches a rejection that also
      // arrived via the rejection-report path, so the two feeds never double-count.
      const rowRes = await tx.execute(sql`
        INSERT INTO sip_rejections (
          tenant_id, investor_id, transaction_id, rejection_date, rejection_amount,
          rejection_reason, scheme_name, folio_number, amc_name, assigned_rm_id,
          follow_up_date, recovery_status, reason_category, dedup_key
        )
        SELECT t.tenant_id, t.investor_id, t.id, t.order_date::date, t.amount,
          t.reason_description, t.scheme_name, t.folio_number, t.amc_name, i.rm_id,
          (t.order_date::date + 2), 'pending',
          CASE
            WHEN lower(coalesce(t.reason_description, '') || ' ' || coalesce(t.reason_code, ''))
                 ~ 'insufficient|balance|funds|nsf|inqufd' THEN 'insufficient_balance'
            WHEN lower(coalesce(t.reason_description, '') || ' ' || coalesce(t.reason_code, ''))
                 ~ 'mandate|expired|umrn|nach|debit not|not registered' THEN 'mandate_expired'
            ELSE 'technical'
          END,
          'tx:' || t.id::text
        FROM transactions t
        JOIN investors i ON i.id = t.investor_id
        WHERE t.type = 'sip'
          AND t.status IN ('rejected', 'failed')
          AND t.created_at >= now() - interval '${since}'
          AND NOT EXISTS (
            SELECT 1 FROM sip_rejections sr
            WHERE sr.tenant_id = t.tenant_id AND sr.transaction_id = t.id
          )
          AND NOT EXISTS (
            SELECT 1 FROM sip_rejections sr
            WHERE sr.tenant_id = t.tenant_id
              AND sr.investor_id = t.investor_id
              AND sr.rejection_date = t.order_date::date
              AND sr.rejection_amount = t.amount
          )
        ON CONFLICT (tenant_id, transaction_id) WHERE transaction_id IS NOT NULL DO NOTHING
        RETURNING 1
      `);
      result.sipRejectionRows = rowRes.rows.length;

      // ── 2c. SLA escalation — rejections unrecovered > 2 days ─────────────
      // The page flags "SLA breached" passively; this makes it act. For each
      // open rejection past the 2-day SLA that hasn't been escalated yet, ping
      // the owner / branch-head + assigned RM, bump the linked open task(s) to
      // urgent, emit an event, and stamp escalated_at so we notify once.
      const overdue = await tx.execute(sql`
        SELECT r.id, r.investor_id, r.assigned_rm_id, r.rejection_amount, r.scheme_name,
               i.name AS investor_name
        FROM sip_rejections r
        JOIN investors i ON i.id = r.investor_id
        WHERE r.recovery_status IN ('pending', 'client_contacted', 'bank_issue', 'mandate_issue')
          AND (now() - r.status_changed_at) > interval '2 days'
          AND r.escalated_at IS NULL
        LIMIT 1000
      `);
      const overdueRows = overdue.rows as Array<{
        id: string;
        investor_id: string;
        assigned_rm_id: string | null;
        rejection_amount: string;
        scheme_name: string | null;
        investor_name: string | null;
      }>;

      if (overdueRows.length) {
        // Escalation audience: owners + branch heads of the tenant.
        const leads = await tx.execute(sql`
          SELECT id FROM users
          WHERE tenant_id = ${tenantId}::uuid
            AND roles && ARRAY['owner', 'branch_head']::text[]
        `);
        const leadIds = (leads.rows as Array<{ id: string }>).map((u) => u.id);

        for (const r of overdueRows) {
          const recipients = new Set<string>(leadIds);
          if (r.assigned_rm_id) recipients.add(r.assigned_rm_id);
          const amount = "₹" + Number(r.rejection_amount).toLocaleString("en-IN");
          for (const userId of recipients) {
            await tx.execute(sql`
              INSERT INTO notifications (tenant_id, user_id, kind, title, body, link_url, severity, meta)
              VALUES (
                ${tenantId}::uuid, ${userId}::uuid, 'sip.rejection.sla_breached',
                ${`SIP recovery overdue — ${r.investor_name ?? "client"}`},
                ${`${amount} unrecovered for >2 days${r.scheme_name ? ` · ${r.scheme_name}` : ""}`},
                '/dashboard/sip-rejections?overdue=1', 'critical',
                ${JSON.stringify({ rejection_id: r.id, investor_id: r.investor_id })}::jsonb
              )
            `);
          }
        }

        const rejIds = overdueRows.map((r) => r.id);
        const invIds = [...new Set(overdueRows.map((r) => r.investor_id))];

        // Bump linked open follow-up tasks to urgent.
        await tx.execute(sql`
          UPDATE tasks SET priority = 'urgent', updated_at = now()
          WHERE subject_type = 'investor'
            AND status IN ('open', 'in_progress')
            AND priority <> 'urgent'
            AND type IN ('sip_rejection_followup', 'sip_retry', 'mandate_renewal', 'sip_review')
            AND subject_id IN (${sql.join(invIds.map((x) => sql`${x}::uuid`), sql`, `)})
        `);

        // Emit an event so any subscribed workflow can react to the breach.
        await tx.execute(sql`
          INSERT INTO events_outbox (tenant_id, kind, entity_type, entity_id, after, meta)
          SELECT ${tenantId}::uuid, 'sip.rejection.sla_breached', 'sip_rejection', r.id,
            jsonb_build_object('investor_id', r.investor_id, 'amount', r.rejection_amount),
            jsonb_build_object('source', 'reconciliation-scanner')
          FROM sip_rejections r
          WHERE r.id IN (${sql.join(rejIds.map((x) => sql`${x}::uuid`), sql`, `)})
        `);

        // Stamp escalated_at last — notify once, not every daily run.
        await tx.execute(sql`
          UPDATE sip_rejections SET escalated_at = now(), updated_at = now()
          WHERE id IN (${sql.join(rejIds.map((x) => sql`${x}::uuid`), sql`, `)})
        `);

        result.slaEscalations = overdueRows.length;
      }

      // ── 3. AUM drift (report-only) ────────────────────────────────────
      // Flag — but never silently overwrite — investors whose stored AUM has
      // drifted from the sum of their folios by more than ₹1. Surfacing the
      // count tells ops a fuller re-import/valuation pass is warranted.
      const drift = await tx.execute(sql`
        SELECT count(*)::int AS c
        FROM investors i
        WHERE abs(
          COALESCE(i.aum, 0)
          - COALESCE((SELECT SUM(f.aum) FROM folios f WHERE f.investor_id = i.id), 0)
        ) > 1
      `);
      result.aumDriftCount = Number((drift.rows[0] as any)?.c ?? 0);
    },
    { roles: ["system"] }
  );

  result.durationMs = Date.now() - startedAt;
  return result;
}

export async function runReconciliationScan(
  opts: { sinceDays?: number } = {}
): Promise<{
  tenants: number;
  totals: {
    sipRejectionEvents: number;
    redemptionEvents: number;
    sipRejectionRows: number;
    slaEscalations: number;
    aumDriftCount: number;
  };
  failedTenants: string[];
  durationMs: number;
}> {
  const startedAt = Date.now();
  const tenants = await listActiveTenants();
  const failed: string[] = [];
  const totals = {
    sipRejectionEvents: 0,
    redemptionEvents: 0,
    sipRejectionRows: 0,
    slaEscalations: 0,
    aumDriftCount: 0,
  };
  for (const tenantId of tenants) {
    try {
      const r = await reconcileTenant(tenantId, opts);
      totals.sipRejectionEvents += r.sipRejectionEvents;
      totals.redemptionEvents += r.redemptionEvents;
      totals.sipRejectionRows += r.sipRejectionRows;
      totals.slaEscalations += r.slaEscalations;
      totals.aumDriftCount += r.aumDriftCount;
    } catch (err: any) {
      console.error(`[reconciliation-scanner] tenant ${tenantId} failed:`, err.message);
      failed.push(tenantId);
    }
  }
  const durationMs = Date.now() - startedAt;
  console.log(
    `[reconciliation-scanner] scanned ${tenants.length} tenants in ${durationMs}ms`,
    totals
  );
  return { tenants: tenants.length, totals, failedTenants: failed, durationMs };
}
