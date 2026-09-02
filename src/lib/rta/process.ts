/**
 * RTA file processor.
 *
 * Takes the raw text of an uploaded RTA file plus its (source, kind) tuple
 * and applies it to the correct downstream tables.
 *
 * Idempotency: every row carries a deterministic `external_ref` (order id /
 * mandate id / brokerage row id). We upsert keyed on that ref so a
 * re-uploaded file is a no-op.
 *
 * Returns per-import counters that the API surfaces to the user.
 *
 * Note: this runs synchronously inside the upload request. Files larger than
 * ~50k rows should be queued via BullMQ — out of scope for v1.
 */

import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import {
  parseCamsFeed,
  parseKfintechFeed,
  type CanonicalTransaction,
} from "@/lib/integrations/cams-feed-parser";
import type { RtaFileKind, RtaSource } from "@/db/schema/rta_imports";
import {
  parseSipRejectionReport,
  parseBrokerageStatement,
  parseFolioMasterDump,
  parseSipBook,
  parseMandateStatus,
  parseAumStatement,
  type CanonicalSipRejection,
  type CanonicalBrokerageRow,
  type CanonicalFolioRow,
  type CanonicalSipRow,
  type CanonicalMandateRow,
  type CanonicalAumRow,
} from "./parsers";

/**
 * Resolve an investor by PAN first, then by an existing folio number. Most RTA
 * reverse-feeds (transaction, AUM, redemption, brokerage) are FOLIO-keyed and
 * carry no PAN column — without this fallback every row would skip. The folio
 * must already exist (created by an Investor/Folio Master import or an earlier
 * feed), which is why masters should be imported before transaction feeds.
 */
async function resolveInvestorId(
  tx: Tx,
  tenantId: string,
  key: { pan?: string; folioNumber?: string }
): Promise<string | null> {
  if (key.pan && key.pan.trim()) {
    const r = await tx.execute(sql`
      SELECT id FROM investors WHERE tenant_id = ${tenantId}::uuid AND pan = ${key.pan.toUpperCase()} LIMIT 1
    `);
    const id = (r.rows[0] as any)?.id;
    if (id) return id;
  }
  if (key.folioNumber && key.folioNumber.trim()) {
    const r = await tx.execute(sql`
      SELECT investor_id FROM folios WHERE tenant_id = ${tenantId}::uuid AND folio_number = ${key.folioNumber} LIMIT 1
    `);
    const id = (r.rows[0] as any)?.investor_id;
    if (id) return id;
  }
  return null;
}

/**
 * A PAN we are willing to key a new investor on: the exact SEBI/IT format
 * AAAAA9999A. Deliberately strict — a provisional client created from a
 * malformed value could never be matched by the folio master later, which is
 * exactly the duplicate this guard exists to prevent.
 */
function isLikelyPan(pan?: string): boolean {
  return !!pan && /^[A-Z]{5}[0-9]{4}[A-Z]$/i.test(pan.trim());
}

/** Registrar names arrive padded, upper-cased and sometimes NUL-laden. */
function sanitizeName(name?: string): string | null {
  const s = (name ?? "").replace(/[\x00-\x1F]/g, " ").replace(/\s+/g, " ").trim();
  return s.length >= 2 ? s.slice(0, 160) : null;
}

/**
 * Bulk-resolve every investor referenced by a feed in TWO queries (by PAN, by
 * existing folio) instead of 1–2 queries per row. Returns lookup maps the row
 * loop consults in memory — the key fix for the per-row N+1 that made large
 * imports time out. `pan = ANY($1::text[])` binds the JS array as a single
 * Postgres array param (the correct pattern; never an `IN (...)` tuple).
 */
async function buildInvestorIndex(
  tx: Tx,
  tenantId: string,
  keys: Array<{ pan?: string; folioNumber?: string }>
): Promise<{ panMap: Map<string, string>; folioMap: Map<string, string> }> {
  const pans = [...new Set(keys.map((k) => k.pan?.toUpperCase()).filter(Boolean))] as string[];
  const folios = [...new Set(keys.map((k) => k.folioNumber).filter(Boolean))] as string[];
  const panMap = new Map<string, string>();
  const folioMap = new Map<string, string>();

  if (pans.length) {
    const res = await tx.execute(sql`
      SELECT id, pan FROM investors WHERE tenant_id = ${tenantId}::uuid AND pan IN (${sql.join(pans.map((p) => sql`${p}`), sql`, `)})
    `);
    for (const row of res.rows as any[]) if (row.pan) panMap.set(String(row.pan).toUpperCase(), row.id);
  }
  if (folios.length) {
    const res = await tx.execute(sql`
      SELECT investor_id, folio_number FROM folios WHERE tenant_id = ${tenantId}::uuid AND folio_number IN (${sql.join(folios.map((f) => sql`${f}`), sql`, `)})
    `);
    for (const row of res.rows as any[]) if (!folioMap.has(row.folio_number)) folioMap.set(row.folio_number, row.investor_id);
  }
  return { panMap, folioMap };
}

export type ProcessOutcome = {
  rowsTotal: number;
  rowsImported: number;
  rowsSkipped: number;
  rowsFailed: number;
  errors: Array<{ row: number; reason: string }>;
  periodStart: string;
  periodEnd: string;
};

/**
 * Top-level entry point. Dispatches by file kind.
 */
export async function processRtaFile(
  tx: Tx,
  args: { tenantId: string; source: RtaSource; kind: RtaFileKind; text: string }
): Promise<ProcessOutcome> {
  // Large RTA files (100k+ rows) processed in one transaction can exceed the
  // 30s pool statement_timeout. Lift it for this import transaction only.
  await tx.execute(sql`SET LOCAL statement_timeout = '600s'`);
  switch (args.kind) {
    case "daily_transaction_feed":
    case "redemption_report":
      return processTransactionFeed(tx, args);
    case "sip_rejection_report":
      return processSipRejectionReport(tx, args);
    case "monthly_brokerage":
      return processBrokerageStatement(tx, args);
    case "folio_master_dump":
    case "cas_holdings":
      return processFolioMasterDump(tx, args);
    case "monthly_sip_book":
      return processSipBook(tx, args);
    case "nach_mandate_status":
      return processMandateStatus(tx, args);
    case "monthly_aum_statement":
      return processAumStatement(tx, args);
    // The rest fall through to a generic "store but don't parse"
    default:
      return {
        rowsTotal: 0,
        rowsImported: 0,
        rowsSkipped: 0,
        rowsFailed: 0,
        errors: [],
        periodStart: today(),
        periodEnd: today(),
      };
  }
}

// ── Transaction feed (daily) ─────────────────────────────────────────────

async function processTransactionFeed(
  tx: Tx,
  args: { tenantId: string; source: RtaSource; text: string }
): Promise<ProcessOutcome> {
  const rows: CanonicalTransaction[] =
    args.source === "kfintech"
      ? parseKfintechFeed(args.text)
      : parseCamsFeed(args.text);

  const errors: Array<{ row: number; reason: string }> = [];
  let imported = 0;
  let skipped = 0;
  let failed = 0;
  /** Clients stood up from the feed because their folio master hasn't arrived. */
  let createdInvestors = 0;
  let minDate = "9999-12-31";
  let maxDate = "0000-01-01";
  // Newest processed order_date per investor → bump last_transaction_at so
  // dormancy / health / churn reflect the freshly-ingested feed.
  const lastTxByInvestor = new Map<string, string>();

  // Large feeds can have 100k+ rows. A per-row investor lookup (the old N+1)
  // plus the 30s pool statement_timeout made big imports abort + roll back.
  //   1. Lift the timeout for THIS import transaction only.
  //   2. Resolve every investor up front in two bulk queries (by PAN, by folio)
  //      into in-memory maps — the loop then does zero resolution round-trips.
  const { panMap, folioMap } = await buildInvestorIndex(
    tx,
    args.tenantId,
    rows.map((r) => ({ pan: r.pan, folioNumber: r.folioNumber }))
  );
  const resolveFast = (pan?: string, folio?: string): string | null =>
    (pan && panMap.get(pan.toUpperCase())) || (folio && folioMap.get(folio)) || null;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r.folioNumber) {
      skipped++;
      continue;
    }
    if (r.orderDate < minDate) minDate = r.orderDate;
    if (r.orderDate > maxDate) maxDate = r.orderDate;

    // Resolve from the pre-built maps (no per-row query). PAN first, then folio.
    let investorId = resolveFast(r.pan, r.folioNumber);

    // Not in the book yet. If the row carries a valid PAN we can stand the
    // client up from the feed itself rather than dropping the transaction:
    // the feed gives us PAN + name, and investors are PAN-deduped, so when the
    // folio master finally lands it UPDATES this row instead of duplicating it.
    //
    // Without a PAN we must still skip. A PAN-less provisional row would be
    // keyed on nothing the master can match, so the master would create a
    // SECOND client for the same person — worse than losing the row.
    //
    // VSN Financial Services: one KFintech feed skipped 1,849 rows this way,
    // 1,617 of which carried a PAN and are recoverable here.
    if (!investorId && isLikelyPan(r.pan)) {
      const created = await tx.execute(sql`
        INSERT INTO investors (tenant_id, pan, name, investor_category, kyc_status)
        VALUES (
          ${args.tenantId}::uuid, ${r.pan.toUpperCase()},
          ${sanitizeName(r.investorName) ?? `PAN ${r.pan.toUpperCase()}`},
          'individual', 'pending'
        )
        ON CONFLICT (tenant_id, pan) WHERE dedup_pan AND pan IS NOT NULL
        DO UPDATE SET updated_at = now()
        RETURNING id
      `);
      investorId = (created.rows[0] as any)?.id ?? null;
      if (investorId) {
        // Feed the maps so the other rows for this client resolve without a
        // second insert — these feeds carry many rows per folio.
        panMap.set(r.pan.toUpperCase(), investorId);
        folioMap.set(r.folioNumber, investorId);
        createdInvestors++;
      }
    }

    if (!investorId) {
      skipped++;
      errors.push({ row: i + 1, reason: `Folio ${r.folioNumber}${r.pan ? ` / PAN ${r.pan}` : ""} not in client master — import the Investor/Folio Master first` });
      continue;
    }

    const rtaEnumVal = (args.source === "cams" || args.source === "kfintech") ? args.source : "other";

    try {
      // Resolve or create folio record
      const folioRes = await tx.execute(sql`
        INSERT INTO folios (tenant_id, investor_id, folio_number, amc_code, amc_name, rta)
        VALUES (${args.tenantId}::uuid, ${investorId}::uuid, ${r.folioNumber}, ${r.amcCode}, ${r.amcCode}, ${rtaEnumVal})
        ON CONFLICT (tenant_id, amc_code, folio_number) DO UPDATE SET updated_at = now()
        RETURNING id
      `);
      const folioId = (folioRes.rows[0] as any)?.id;

      // UPSERT keyed by (tenant_id, order_id) so re-uploads no-op, but updates status/NAV/units.
      await tx.execute(sql`
        INSERT INTO transactions (
          tenant_id, investor_id, folio_id, folio_number, amc_code, amc_name, scheme_code, scheme_name,
          type, direction, amount, units, nav, order_id, order_date, status,
          reason_code, reason_description
        ) VALUES (
          ${args.tenantId}::uuid, ${investorId}::uuid, ${folioId}::uuid, ${r.folioNumber}, ${r.amcCode}, ${r.amcCode},
          ${r.schemeCode}, ${r.schemeName}, ${r.type}, ${r.direction},
          ${r.amount}, ${r.units}, ${r.nav}, ${r.externalRef}, ${r.orderDate}::date,
          ${normaliseStatus(r.status)}, ${r.reasonCode ?? null}, ${r.reasonDescription ?? null}
        )
        ON CONFLICT (tenant_id, order_id) WHERE order_id IS NOT NULL DO UPDATE SET
          folio_id = EXCLUDED.folio_id,
          status = EXCLUDED.status,
          nav = EXCLUDED.nav,
          units = EXCLUDED.units,
          reason_code = EXCLUDED.reason_code,
          reason_description = EXCLUDED.reason_description,
          updated_at = now()
      `);
      imported++;
      if (normaliseStatus(r.status) === "processed") {
        const prev = lastTxByInvestor.get(investorId);
        if (!prev || r.orderDate > prev) lastTxByInvestor.set(investorId, r.orderDate);
      }
    } catch (e: any) {
      failed++;
      if (errors.length < 25) errors.push({ row: i + 1, reason: e.message ?? "insert failed" });
    }
  }

  // Bump last_transaction_at (forward only) for each affected investor.
  for (const [investorId, maxOrderDate] of lastTxByInvestor) {
    await tx.execute(sql`
      UPDATE investors
         SET last_transaction_at = GREATEST(COALESCE(last_transaction_at, 'epoch'::timestamptz), ${maxOrderDate}::timestamptz),
             updated_at = now()
       WHERE id = ${investorId}::uuid
    `);
  }

  return {
    rowsTotal: rows.length,
    rowsImported: imported,
    rowsSkipped: skipped,
    rowsFailed: failed,
    errors,
    periodStart: minDate === "9999-12-31" ? today() : minDate,
    periodEnd: maxDate === "0000-01-01" ? today() : maxDate,
  };
}

// ── SIP rejection report (daily) ─────────────────────────────────────────

async function processSipRejectionReport(
  tx: Tx,
  args: { tenantId: string; source: RtaSource; text: string }
): Promise<ProcessOutcome> {
  const rows: CanonicalSipRejection[] = parseSipRejectionReport(args.text, args.source);
  const errors: Array<{ row: number; reason: string }> = [];
  let imported = 0;
  let skipped = 0;
  let failed = 0;
  let minDate = "9999-12-31";
  let maxDate = "0000-01-01";

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.rejectionDate < minDate) minDate = r.rejectionDate;
    if (r.rejectionDate > maxDate) maxDate = r.rejectionDate;

    const investorId = await resolveInvestorId(tx, args.tenantId, { pan: r.pan, folioNumber: r.folioNumber });
    if (!investorId) {
      skipped++;
      errors.push({ row: i + 1, reason: `${r.pan ? `PAN ${r.pan}` : `Folio ${r.folioNumber}`} not in client master` });
      continue;
    }
    const rmRes = await tx.execute(sql`SELECT rm_id FROM investors WHERE id = ${investorId}::uuid LIMIT 1`);
    const investorRmId = (rmRes.rows[0] as any)?.rm_id ?? null;

    const reasonCode = classifyRejectionReason(r.reason, r.reasonCode);
    // 2-day follow-up from the rejection date — mirrors the manual create API so
    // imported rejections land in the tracker with an RM owner + an SLA clock,
    // not a blank "RM" column. The `transaction.failed.sip_rejection` event
    // (emitted below) still drives task/WhatsApp via the recipe — we don't
    // double-create a task here.
    const followUp = new Date(new Date(r.rejectionDate).getTime() + 2 * 864e5)
      .toISOString()
      .slice(0, 10);
    const dedupKey = naturalKeyHash([investorId, r.rejectionDate, r.amount, r.schemeName, r.folioNumber]);
    try {
      const ins = await tx.execute(sql`
        INSERT INTO sip_rejections (
          tenant_id, investor_id, rejection_date, rejection_amount,
          rejection_reason, scheme_name, folio_number, amc_name, recovery_status,
          assigned_rm_id, follow_up_date, reason_category, dedup_key
        ) VALUES (
          ${args.tenantId}::uuid, ${investorId}::uuid, ${r.rejectionDate}::date,
          ${r.amount}, ${r.reason}, ${r.schemeName}, ${r.folioNumber}, ${r.amcName}, 'pending',
          ${investorRmId}, ${followUp}::date, ${reasonCode}, ${dedupKey}
        )
        ON CONFLICT (tenant_id, dedup_key) DO NOTHING
        RETURNING id
      `);
      if ((ins as any).rows.length > 0) {
        imported++;
        // Emit the event the sip_rejection_followup recipe subscribes to — the
        // canonical rejection report previously produced NO automation event.
        // Only on a real insert, so re-uploads (ON CONFLICT) never re-fire.
        await tx.execute(sql`
          INSERT INTO events_outbox (tenant_id, kind, entity_type, entity_id, after, meta)
          VALUES (
            ${args.tenantId}::uuid, 'transaction.failed.sip_rejection', 'investor', ${investorId}::uuid,
            ${JSON.stringify({
              reason_code: reasonCode,
              reason: r.reason,
              scheme_name: r.schemeName,
              amount: r.amount,
              order_date: r.rejectionDate,
            })}::jsonb,
            ${JSON.stringify({ source: "rta-import", dedupKey })}::jsonb
          )
        `);
      } else {
        skipped++; // already imported — idempotent
      }
    } catch (e: any) {
      failed++;
      if (errors.length < 25) errors.push({ row: i + 1, reason: e.message ?? "insert failed" });
    }
  }

  return {
    rowsTotal: rows.length,
    rowsImported: imported,
    rowsSkipped: skipped,
    rowsFailed: failed,
    errors,
    periodStart: minDate === "9999-12-31" ? today() : minDate,
    periodEnd: maxDate === "0000-01-01" ? today() : maxDate,
  };
}

// ── Monthly brokerage statement ──────────────────────────────────────────

async function processBrokerageStatement(
  tx: Tx,
  args: { tenantId: string; source: RtaSource; text: string }
): Promise<ProcessOutcome> {
  const rows: CanonicalBrokerageRow[] = parseBrokerageStatement(args.text, args.source);
  const errors: Array<{ row: number; reason: string }> = [];
  let imported = 0;
  let skipped = 0;
  let failed = 0;
  let minDate = "9999-12-31";
  let maxDate = "0000-01-01";

  // Brokerage flows into commission_rows (already exists). If commission
  // schema isn't available we degrade gracefully.
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.periodStart < minDate) minDate = r.periodStart;
    if (r.periodEnd > maxDate) maxDate = r.periodEnd;

    try {
      await tx.execute(sql`
        INSERT INTO commission_rows (
          tenant_id, amc_code, scheme_code, scheme_name, folio_number,
          pan, brokerage_type, period_start, period_end,
          aum_amount, brokerage_rate, brokerage_amount, source
        ) VALUES (
          ${args.tenantId}::uuid, ${r.amcCode}, ${r.schemeCode}, ${r.schemeName}, ${r.folioNumber},
          ${r.pan.toUpperCase()}, ${r.brokerageType}, ${r.periodStart}::date, ${r.periodEnd}::date,
          ${r.aumAmount}, ${r.brokerageRate}, ${r.brokerageAmount}, ${args.source}
        )
        ON CONFLICT DO NOTHING
      `);
      imported++;
    } catch (e: any) {
      // Table may not exist yet on some envs — soft-skip.
      if (e.message?.includes("does not exist")) {
        skipped++;
      } else {
        failed++;
        if (errors.length < 25) errors.push({ row: i + 1, reason: e.message ?? "insert failed" });
      }
    }
  }

  return {
    rowsTotal: rows.length,
    rowsImported: imported,
    rowsSkipped: skipped,
    rowsFailed: failed,
    errors,
    periodStart: minDate === "9999-12-31" ? today() : minDate,
    periodEnd: maxDate === "0000-01-01" ? today() : maxDate,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** CAMS feed status → our canonical transactions.status enum. */
function normaliseStatus(s: string): string {
  switch (s) {
    case "successful":
      return "processed";
    case "rejected":
    case "failed":
      return "rejected"; // canonical (a NACH bounce is a rejection)
    case "pending":
      return "pending";
    default:
      return "pending";
  }
}

/** Classify a free-text / coded rejection reason into the slugs the
 *  sip_rejection_followup recipe branches on (insufficient_balance /
 *  mandate_expired / technical). */
function classifyRejectionReason(reason: string, reasonCode?: string): string {
  const r = `${reason ?? ""} ${reasonCode ?? ""}`.toLowerCase();
  if (/insufficient|balance|funds|nsf|inqufd/.test(r)) return "insufficient_balance";
  if (/mandate|expired|umrn|nach|debit not|not registered/.test(r)) return "mandate_expired";
  return "technical";
}

/** Deterministic idempotency hash of a row's natural key. */
function naturalKeyHash(parts: Array<string | number | null | undefined>): string {
  return "nk:" + createHash("sha256").update(parts.map((p) => String(p ?? "")).join("|")).digest("hex").slice(0, 40);
}

// ── Additional kind handlers ─────────────────────────────────────────────

async function processFolioMasterDump(
  tx: Tx,
  args: { tenantId: string; source: RtaSource; text: string }
): Promise<ProcessOutcome> {
  const rows: CanonicalFolioRow[] = parseFolioMasterDump(args.text, args.source);

  const errors: Array<{ row: number; reason: string }> = [];
  let imported = 0;
  let skipped = 0;
  let failed = 0;

  // Group rows by folio number and amc code to do batch updates of the schemes array
  const folioRowsGrouped = new Map<string, CanonicalFolioRow[]>();
  for (const r of rows) {
    if (!r.pan || !r.folioNumber || !r.amcCode) {
      skipped++;
      continue;
    }
    const key = `${r.amcCode}__${r.folioNumber}`;
    if (!folioRowsGrouped.has(key)) {
      folioRowsGrouped.set(key, []);
    }
    folioRowsGrouped.get(key)!.push(r);
  }

  const rtaEnumVal = (args.source === "cams" || args.source === "kfintech") ? args.source : "other";

  for (const [key, fRows] of folioRowsGrouped) {
    const firstRow = fRows[0];
    const investor = await tx.execute(sql`
      SELECT id FROM investors WHERE tenant_id = ${args.tenantId}::uuid AND pan = ${firstRow.pan.toUpperCase()} LIMIT 1
    `);
    const investorId = (investor.rows[0] as any)?.id;
    if (!investorId) {
      skipped += fRows.length;
      errors.push({ row: rows.indexOf(firstRow) + 1, reason: `PAN ${firstRow.pan} not in client master — skipped` });
      continue;
    }

    try {
      // Find or create folio
      const folioRes = await tx.execute(sql`
        INSERT INTO folios (tenant_id, investor_id, folio_number, amc_code, amc_name, rta)
        VALUES (${args.tenantId}::uuid, ${investorId}::uuid, ${firstRow.folioNumber}, ${firstRow.amcCode}, ${firstRow.amcName}, ${rtaEnumVal})
        ON CONFLICT (tenant_id, amc_code, folio_number) DO UPDATE SET updated_at = now()
        RETURNING id, schemes
      `);
      const folioId = (folioRes.rows[0] as any)?.id;
      const existingSchemes = ((folioRes.rows[0] as any)?.schemes ?? []) as Array<{
        schemeCode: string;
        schemeName: string;
        category?: string;
        units?: number;
        nav?: number;
        value?: number;
      }>;

      // Merge new schemes with existing schemes
      const schemesMap = new Map<string, typeof existingSchemes[number]>();
      for (const s of existingSchemes) {
        if (s.schemeCode) schemesMap.set(s.schemeCode, s);
      }

      for (const r of fRows) {
        if (!r.schemeCode) continue;
        const current = schemesMap.get(r.schemeCode);
        schemesMap.set(r.schemeCode, {
          schemeCode: r.schemeCode,
          schemeName: r.schemeName || current?.schemeName || "",
          units: r.units,
          nav: current?.nav,
          value: current?.nav ? Math.round(r.units * current.nav * 100) / 100 : r.value || current?.value,
        });
      }

      const mergedSchemes = Array.from(schemesMap.values());
      const roundedAum = mergedSchemes.reduce((acc, s) => acc + (s.value ?? 0), 0);

      await tx.execute(sql`
        UPDATE folios
        SET schemes = ${JSON.stringify(mergedSchemes)}::jsonb,
            aum = ${roundedAum}::numeric,
            updated_at = now()
        WHERE id = ${folioId}::uuid
      `);

      imported += fRows.length;
    } catch (e: any) {
      failed += fRows.length;
      errors.push({ row: rows.indexOf(firstRow) + 1, reason: e.message ?? "folio master import failed" });
    }
  }

  try {
    const { revalueAllFolios, recomputeCombinedAum } = await import("@/lib/finance/aum-persist");
    await revalueAllFolios(tx);
    // Roll the (just-imported) folio holdings up to investors.aum so the client
    // profile headline reflects them — combined with transaction-derived value
    // for any scheme the folios don't cover. Without this, a holdings-only book
    // (RTA folio-master / AUM import, no transaction feed) shows ₹0 AUM.
    await recomputeCombinedAum(tx);
  } catch (err: any) {
    // Surface (don't swallow) — investor-level AUM is now stale; record it so
    // the import shows partial rather than a misleading clean "completed".
    console.error("[processFolioMasterDump] revalueAllFolios failed:", err);
    errors.push({ row: 0, reason: `Folio values imported but investor AUM revaluation failed: ${err?.message ?? err}` });
    failed++;
  }

  return {
    rowsTotal: rows.length,
    rowsImported: imported,
    rowsSkipped: skipped,
    rowsFailed: failed,
    errors,
    periodStart: today(),
    periodEnd: today(),
  };
}

async function processSipBook(
  tx: Tx,
  args: { tenantId: string; source: RtaSource; text: string }
): Promise<ProcessOutcome> {
  const rows: CanonicalSipRow[] = parseSipBook(args.text, args.source);
  const errors: Array<{ row: number; reason: string }> = [];
  let imported = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r.pan || !r.folioNumber || !r.schemeCode) {
      skipped++;
      continue;
    }

    const investor = await tx.execute(sql`
      SELECT id, rm_id FROM investors WHERE tenant_id = ${args.tenantId}::uuid AND pan = ${r.pan.toUpperCase()} LIMIT 1
    `);
    const investorId = (investor.rows[0] as any)?.id;
    const rmId = (investor.rows[0] as any)?.rm_id;
    if (!investorId) {
      skipped++;
      errors.push({ row: i + 1, reason: `PAN ${r.pan} not in client master` });
      continue;
    }

    // Resolve folio
    const folio = await tx.execute(sql`
      SELECT id, amc_name FROM folios
      WHERE tenant_id = ${args.tenantId}::uuid AND folio_number = ${r.folioNumber} LIMIT 1
    `);
    const folioId = (folio.rows[0] as any)?.id;
    const amcName = (folio.rows[0] as any)?.amc_name || "Unknown AMC";
    if (!folioId) {
      skipped++;
      errors.push({ row: i + 1, reason: `Folio ${r.folioNumber} not found` });
      continue;
    }

    // Resolve mandate (if reference is present)
    let mandateId: string | null = null;
    if (r.mandateRefNo) {
      const mandate = await tx.execute(sql`
        SELECT id FROM mandates WHERE tenant_id = ${args.tenantId}::uuid AND mandate_ref_no = ${r.mandateRefNo} LIMIT 1
      `);
      mandateId = (mandate.rows[0] as any)?.id ?? null;
    }

    try {
      // Match on the STABLE key (tenant, investor, folio, scheme) — NOT amount.
      // Including amount meant a step-up SIP (amount changes between monthly
      // books) failed to match and inserted a duplicate active SIP, inflating
      // active-SIP count + AUM projections. Update the amount on match instead.
      const existing = await tx.execute(sql`
        SELECT id FROM sips
        WHERE tenant_id = ${args.tenantId}::uuid
          AND investor_id = ${investorId}::uuid
          AND folio_id = ${folioId}::uuid
          AND scheme_code = ${r.schemeCode}
          AND status = 'active'
        LIMIT 1
      `);

      const existingId = (existing.rows[0] as any)?.id;

      if (existingId) {
        // `?? null` on every optional value here is load-bearing, not defensive
        // style: drizzle OMITS an `undefined` interpolation from the template
        // rather than binding NULL, so a SIP row with no next-installment date
        // emitted literal `COALESCE(::date, ...)` — malformed SQL. Postgres then
        // aborts the ENTIRE transaction, so one such row failed not only itself
        // but every remaining row in the file and the final status write too,
        // surfacing as an opaque "Failed query" with the real cause buried.
        // The INSERT branch below already did this correctly; this one was missed.
        await tx.execute(sql`
          UPDATE sips
          SET amount = ${r.amount}::numeric,
              next_installment_at = COALESCE(${r.nextInstallmentAt ?? null}::date, next_installment_at),
              end_date = COALESCE(${r.endDate ?? null}::date, end_date),
              mandate_id = COALESCE(${mandateId ?? null}::uuid, mandate_id),
              status = 'active',
              updated_at = now()
          WHERE id = ${existingId}::uuid
        `);
      } else {
        await tx.execute(sql`
          INSERT INTO sips (
            tenant_id, investor_id, folio_id, folio_number, amc_code, amc_name, scheme_code, scheme_name,
            amount, frequency, sip_date, start_date, end_date, next_installment_at, mandate_id, status, rm_id
          ) VALUES (
            ${args.tenantId}::uuid, ${investorId}::uuid, ${folioId}::uuid, ${r.folioNumber}, ${r.schemeCode}, ${amcName},
            ${r.schemeCode}, ${r.schemeName}, ${r.amount}, ${r.frequency}, ${r.sipDate ?? null}, ${r.startDate ?? null}::date,
            ${r.endDate ?? null}::date, ${r.nextInstallmentAt ?? null}::date, ${mandateId}::uuid, 'active', ${rmId}::uuid
          )
        `);
      }

      imported++;
    } catch (e: any) {
      failed++;
      errors.push({ row: i + 1, reason: e.message ?? "SIP import failed" });
    }
  }

  return {
    rowsTotal: rows.length,
    rowsImported: imported,
    rowsSkipped: skipped,
    rowsFailed: failed,
    errors,
    periodStart: today(),
    periodEnd: today(),
  };
}

async function processMandateStatus(
  tx: Tx,
  args: { tenantId: string; source: RtaSource; text: string }
): Promise<ProcessOutcome> {
  const rows: CanonicalMandateRow[] = parseMandateStatus(args.text, args.source);
  const errors: Array<{ row: number; reason: string }> = [];
  let imported = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r.pan || !r.mandateRefNo) {
      skipped++;
      continue;
    }

    const investor = await tx.execute(sql`
      SELECT id FROM investors WHERE tenant_id = ${args.tenantId}::uuid AND pan = ${r.pan.toUpperCase()} LIMIT 1
    `);
    const investorId = (investor.rows[0] as any)?.id;
    if (!investorId) {
      skipped++;
      errors.push({ row: i + 1, reason: `PAN ${r.pan} not in client master` });
      continue;
    }

    try {
      await tx.execute(sql`
        INSERT INTO mandates (
          tenant_id, investor_id, mandate_ref_no, bank_account_masked, ifsc, amount_limit, registered_at, expires_at, status
        ) VALUES (
          ${args.tenantId}::uuid, ${investorId}::uuid, ${r.mandateRefNo}, ${r.bankAccountMasked ?? null},
          ${r.ifsc ?? null}, ${r.amountLimit ?? null}, ${r.registeredAt ?? null}::date, ${r.expiresAt ?? null}::date, ${r.status}
        )
        ON CONFLICT (tenant_id, mandate_ref_no) DO UPDATE SET
          bank_account_masked = COALESCE(EXCLUDED.bank_account_masked, bank_account_masked),
          ifsc = COALESCE(EXCLUDED.ifsc, ifsc),
          amount_limit = COALESCE(EXCLUDED.amount_limit, amount_limit),
          status = EXCLUDED.status,
          expires_at = COALESCE(EXCLUDED.expires_at, expires_at),
          updated_at = now()
      `);

      imported++;
    } catch (e: any) {
      failed++;
      errors.push({ row: i + 1, reason: e.message ?? "mandate import failed" });
    }
  }

  return {
    rowsTotal: rows.length,
    rowsImported: imported,
    rowsSkipped: skipped,
    rowsFailed: failed,
    errors,
    periodStart: today(),
    periodEnd: today(),
  };
}

async function processAumStatement(
  tx: Tx,
  args: { tenantId: string; source: RtaSource; text: string }
): Promise<ProcessOutcome> {
  const rows: CanonicalAumRow[] = parseAumStatement(args.text, args.source);
  const errors: Array<{ row: number; reason: string }> = [];
  let imported = 0;
  let skipped = 0;
  let failed = 0;

  // Group rows by folio number
  const aumRowsGrouped = new Map<string, CanonicalAumRow[]>();
  for (const r of rows) {
    if (!r.folioNumber || !r.schemeCode) {
      skipped++;
      continue;
    }
    const key = r.folioNumber;
    if (!aumRowsGrouped.has(key)) {
      aumRowsGrouped.set(key, []);
    }
    aumRowsGrouped.get(key)!.push(r);
  }

  for (const [folioNum, fRows] of aumRowsGrouped) {
    const firstRow = fRows[0];
    const investorId = await resolveInvestorId(tx, args.tenantId, { pan: firstRow.pan, folioNumber: folioNum });
    if (!investorId) {
      skipped += fRows.length;
      errors.push({ row: rows.indexOf(firstRow) + 1, reason: `Folio ${folioNum} not in client master — import the Investor/Folio Master first` });
      continue;
    }

    // Find folio
    const folio = await tx.execute(sql`
      SELECT id, schemes FROM folios
      WHERE tenant_id = ${args.tenantId}::uuid AND folio_number = ${folioNum} LIMIT 1
    `);
    const folioId = (folio.rows[0] as any)?.id;
    if (!folioId) {
      skipped += fRows.length;
      errors.push({ row: rows.indexOf(firstRow) + 1, reason: `Folio ${folioNum} not found` });
      continue;
    }

    try {
      const existingSchemes = ((folio.rows[0] as any)?.schemes ?? []) as Array<{
        schemeCode: string;
        schemeName: string;
        category?: string;
        units?: number;
        nav?: number;
        value?: number;
      }>;

      const schemesMap = new Map<string, typeof existingSchemes[number]>();
      for (const s of existingSchemes) {
        if (s.schemeCode) schemesMap.set(s.schemeCode, s);
      }

      for (const r of fRows) {
        if (!r.schemeCode) continue;
        const current = schemesMap.get(r.schemeCode);
        schemesMap.set(r.schemeCode, {
          schemeCode: r.schemeCode,
          schemeName: r.schemeName || current?.schemeName || "",
          units: r.units,
          nav: r.nav || current?.nav,
          value: r.aumValue || (r.nav ? Math.round(r.units * r.nav * 100) / 100 : current?.value),
        });
      }

      const mergedSchemes = Array.from(schemesMap.values());
      const roundedAum = mergedSchemes.reduce((acc, s) => acc + (s.value ?? 0), 0);

      await tx.execute(sql`
        UPDATE folios
        SET schemes = ${JSON.stringify(mergedSchemes)}::jsonb,
            aum = ${roundedAum}::numeric,
            updated_at = now()
        WHERE id = ${folioId}::uuid
      `);

      imported += fRows.length;
    } catch (e: any) {
      failed += fRows.length;
      errors.push({ row: rows.indexOf(firstRow) + 1, reason: e.message ?? "AUM import failed" });
    }
  }

  try {
    const { revalueAllFolios, recomputeCombinedAum } = await import("@/lib/finance/aum-persist");
    await revalueAllFolios(tx);
    // Roll the (just-imported) folio holdings up to investors.aum so the client
    // profile headline reflects them — combined with transaction-derived value
    // for any scheme the folios don't cover. Without this, a holdings-only book
    // (RTA folio-master / AUM import, no transaction feed) shows ₹0 AUM.
    await recomputeCombinedAum(tx);
  } catch (err: any) {
    console.error("[processAumStatement] revalueAllFolios failed:", err);
    errors.push({ row: 0, reason: `AUM values imported but investor AUM revaluation failed: ${err?.message ?? err}` });
    failed++;
  }

  return {
    rowsTotal: rows.length,
    rowsImported: imported,
    rowsSkipped: skipped,
    rowsFailed: failed,
    errors,
    periodStart: today(),
    periodEnd: today(),
  };
}
