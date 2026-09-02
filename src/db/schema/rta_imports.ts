/**
 * RTA file imports — every file an MFD receives from CAMS / KFintech.
 *
 * The Indian MF industry pushes data to distributors as a set of recurring
 * flat files. Each file has its own cadence (daily / weekly / monthly /
 * quarterly) and its own downstream effect (populate transactions, flag SIP
 * rejections, reconcile brokerage, refresh AUM).
 *
 * This table is the single source of truth for "what arrived, when, and
 * what got populated downstream." The dashboard reads it to show
 * "Last uploaded · Next expected · Late by N days" tiles per file kind.
 *
 * Lifecycle:
 *   uploaded → parsing → completed | failed | partial
 */

import {
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";
import { users } from "./users";

/**
 * Canonical list of every file kind the platform understands.
 * The actual frequency, parser, and "what gets populated" live in
 * src/lib/rta/file-types.ts — this is just the enum so RLS + queries are
 * type-safe.
 */
export const RTA_FILE_KINDS = [
  // ── Daily ────────────────────────────────────────────────────────────
  "daily_transaction_feed",   // CAMS/KFintech T+1 — all new transactions
  "sip_rejection_report",     // SIP NACH bounces, returns
  "nach_mandate_status",      // mandate registrations + cancellations
  "redemption_report",        // daily redemptions for liquidity tracking
  // ── Weekly ───────────────────────────────────────────────────────────
  "wbr_weekly_business",      // Weekly Business Report
  // ── Monthly ──────────────────────────────────────────────────────────
  "monthly_brokerage",        // commission statement (5th-10th of month)
  "monthly_aum_statement",    // AUM snapshot
  "monthly_sip_book",         // active SIP register
  // ── Quarterly ────────────────────────────────────────────────────────
  "folio_master_dump",        // full folio + investor list refresh
  // ── Ad-hoc ───────────────────────────────────────────────────────────
  "corporate_actions",        // dividends, bonus, splits, mergers
  "cas_holdings",             // Consolidated Account Statement
] as const;
export type RtaFileKind = (typeof RTA_FILE_KINDS)[number];

export const RTA_SOURCES = [
  "cams",
  "kfintech",
  "mfu",
  "bse_star_mf",
  "nse_nmf2",
  // LEGACY — the FintechPrimitives (Cybrilla) integration was removed. Kept in
  // the union ONLY so historical rows still type-check and render: 67 imports
  // carry this source. Nothing writes it any more; do not offer it as a choice.
  "fintech_primitives",
] as const;
export type RtaSource = (typeof RTA_SOURCES)[number];

export const RTA_IMPORT_STATUSES = [
  "uploaded",   // file is on disk, processor hasn't picked it up
  "parsing",    // processor is reading rows
  "completed",  // all rows imported successfully
  "partial",    // some rows imported, some failed
  "failed",     // parser couldn't make sense of the file
  "rejected",   // duplicate or wrong format
] as const;
export type RtaImportStatus = (typeof RTA_IMPORT_STATUSES)[number];

export const rtaFileImports = pgTable(
  "rta_file_imports",
  {
    id,
    tenantId,
    source: text("source", { enum: RTA_SOURCES }).notNull(),
    kind: text("kind", { enum: RTA_FILE_KINDS }).notNull(),

    /** Reporting period the file covers. For daily files = the trade date. */
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),

    fileName: text("file_name").notNull(),
    /** S3 / R2 key. Presigned-get URL is generated on demand. */
    fileKey: text("file_key").notNull(),
    fileSizeBytes: integer("file_size_bytes"),
    fileChecksum: text("file_checksum"), // sha256 for duplicate detection

    status: text("status", { enum: RTA_IMPORT_STATUSES }).notNull().default("uploaded"),
    /** When the worker picked this up. */
    parsedAt: timestamp("parsed_at", { withTimezone: true }),

    /** Row counters — drive the post-import summary. */
    rowsTotal: integer("rows_total"),
    rowsImported: integer("rows_imported"),
    rowsSkipped: integer("rows_skipped"),
    rowsFailed: integer("rows_failed"),

    /** First few row-level errors, surfaced to the user. */
    errors: jsonb("errors").$type<Array<{ row: number; reason: string }>>(),
    /** Rich reconciliation summary (investors/folios created vs updated, AUM,
     *  per-AMC breakdown, data-drift) so the import detail shows what changed. */
    summary: jsonb("summary").$type<Record<string, any>>(),
    /** Free-form remarks from the importer (auto or user). */
    remarks: text("remarks"),

    uploadedBy: uuid("uploaded_by").references(() => users.id),

    /** Trash bin — soft-delete so an accidental delete is recoverable. */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),

    ...timestamps,
  },
  (t) => ({
    tenantKindIdx: index("rta_imports_kind_idx").on(
      t.tenantId,
      t.kind,
      t.periodEnd
    ),
    tenantStatusIdx: index("rta_imports_status_idx").on(t.tenantId, t.status),
    /** De-duplicate: same source+kind+period+checksum = already imported. */
    dedupeIdx: index("rta_imports_dedupe_idx").on(
      t.tenantId,
      t.source,
      t.kind,
      t.periodEnd,
      t.fileChecksum
    ),
  })
);

export type RtaFileImport = typeof rtaFileImports.$inferSelect;
export type NewRtaFileImport = typeof rtaFileImports.$inferInsert;
