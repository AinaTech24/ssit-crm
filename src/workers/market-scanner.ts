/**
 * Market scanner — the "when" for the market-volatility recipe.
 *
 * Reads the NIFTY 50 day-change from the configurable index feed and, when the
 * market falls past the threshold (default −2%), emits one
 * `market.nifty_drop` event per marketing-opted-in active investor (so the
 * `market_volatility_broadcast` recipe can send each client a personalised
 * "stay invested" WhatsApp). The comms pipeline still enforces consent +
 * template approval + the WhatsApp session window on every send, so this only
 * fans out the signal — it never bypasses any gate.
 *
 * Throttle / idempotency: each event carries meta.source='market-scanner' and
 * meta.scanDate=YYYY-MM-DD. A partial unique index (migration 0069) makes
 * (tenant_id, kind, entity_id, scanDate) unique for market-scanner rows, and
 * every INSERT uses ON CONFLICT DO NOTHING — so re-running on the same day (the
 * worker ticks hourly) never double-sends. One nudge per client per drop day.
 *
 * Consent pre-filter: we only emit for investors with a GRANTED whatsapp
 * marketing (or all-scope) consent, so we don't generate a pile of
 * skipped_consent audit rows for clients who never opted in.
 */

import { sql } from "drizzle-orm";
import { withSystem, withTenant } from "@/db/client";

export interface MarketScanResult {
  /** Whether the feed returned a usable quote at all. */
  hadQuote: boolean;
  /** The day %-change read from the feed (null when no feed configured). */
  changePct: number | null;
  /** Threshold used (negative). */
  thresholdPct: number;
  /** Whether the drop qualified (changePct <= threshold). */
  qualified: boolean;
  /** Tenants scanned when qualified. */
  tenants: number;
  /** Total `market.nifty_drop` events emitted. */
  emitted: number;
  durationMs: number;
}

async function listActiveTenants(): Promise<string[]> {
  return await withSystem(async (tx) => {
    const r = await tx.execute(
      sql`SELECT id FROM tenants WHERE status IN ('active', 'trial')`
    );
    return (r.rows as Array<{ id: string }>).map((row) => row.id);
  });
}

/**
 * Run one market scan. `asOf` is injected for determinism (no argless Date()).
 */
export async function runMarketScan(
  asOf: string = new Date().toISOString()
): Promise<MarketScanResult> {
  const startedAt = Date.now();
  // Imported lazily so the worker module graph doesn't pull the feed parser
  // into request bundles.
  const { fetchIndexQuote, dropThresholdPct, MARKET_INDEX_NAME } = await import(
    "@/lib/market/index-feed"
  );
  const threshold = dropThresholdPct();

  const quote = await fetchIndexQuote(asOf);
  if (!quote) {
    return {
      hadQuote: false,
      changePct: null,
      thresholdPct: threshold,
      qualified: false,
      tenants: 0,
      emitted: 0,
      durationMs: Date.now() - startedAt,
    };
  }

  const qualified = quote.changePct <= threshold;
  if (!qualified) {
    return {
      hadQuote: true,
      changePct: quote.changePct,
      thresholdPct: threshold,
      qualified: false,
      tenants: 0,
      emitted: 0,
      durationMs: Date.now() - startedAt,
    };
  }

  const scanDate = asOf.slice(0, 10);
  const tenants = await listActiveTenants();
  let emitted = 0;

  for (const tenantId of tenants) {
    try {
      await withTenant(tenantId, async (tx) => {
        // Per-investor fan-out, consent-pre-filtered. ON CONFLICT against the
        // market-scanner dedup index makes the hourly re-tick a no-op.
        const res = await tx.execute(sql`
          INSERT INTO events_outbox (tenant_id, kind, entity_type, entity_id, after, meta)
          SELECT i.tenant_id,
                 'market.nifty_drop',
                 'investor',
                 i.id,
                 jsonb_build_object(
                   'index_name', ${quote.name}::text,
                   'nifty_change_pct', ${quote.changePct}::numeric,
                   'nifty_level', ${quote.level}::numeric,
                   'as_of', ${asOf}::text,
                   'rmId', i.rm_id
                 ),
                 jsonb_build_object('scanDate', ${scanDate}::text, 'source', 'market-scanner')
          FROM investors i
          WHERE i.status = 'active'
            AND i.deleted_at IS NULL
            AND i.phone IS NOT NULL AND i.phone <> ''
            AND EXISTS (
              SELECT 1 FROM consents c
              WHERE c.investor_id = i.id
                AND c.channel = 'whatsapp'
                AND c.scope IN ('marketing', 'all')
                AND c.status = 'granted'
            )
          ON CONFLICT (tenant_id, kind, entity_id, (meta ->> 'scanDate'))
            WHERE meta ->> 'source' = 'market-scanner'
          DO NOTHING
        `);
        emitted += (res as any).rowCount ?? 0;
      });
    } catch (err: any) {
      console.error(`[market-scanner] tenant ${tenantId} failed:`, err?.message ?? err);
    }
  }

  console.log(
    `[market-scanner] ${MARKET_INDEX_NAME} ${quote.changePct.toFixed(2)}% ≤ ${threshold}% — ` +
      `emitted ${emitted} stay-invested nudges across ${tenants.length} tenant(s)`
  );

  return {
    hadQuote: true,
    changePct: quote.changePct,
    thresholdPct: threshold,
    qualified: true,
    tenants: tenants.length,
    emitted,
    durationMs: Date.now() - startedAt,
  };
}
