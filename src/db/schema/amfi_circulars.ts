import { date, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/**
 * AMFI / SEBI regulatory circular digest — PLATFORM-SHARED reference data, NOT
 * tenant-scoped (a circular applies to every MFD identically). Like scheme_nav /
 * recipes / packages it has NO tenant_id and NO RLS policy; the RLS CI guard
 * only checks tenant_id tables, so it's correctly out of scope there.
 *
 * Curated by SSIT (and surfaced to every tenant at /dashboard/compliance/
 * amfi-circulars), each row carries a plain-English summary + the concrete
 * action an MFD must take, so a distributor isn't reading dense regulator PDFs.
 * The AI summariser (/api/ai/circular-summary) helps draft these entries.
 */
export const amfiCirculars = pgTable(
  "amfi_circulars",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Circular / notification reference (e.g. "AMFI/35P/MEM/...", "SEBI/HO/IMD/..."). Unique. */
    circularNo: text("circular_no").notNull(),
    title: text("title").notNull(),
    /** Issuer: AMFI | SEBI | RBI | CBDT | other */
    issuer: text("issuer", { enum: ["AMFI", "SEBI", "RBI", "CBDT", "other"] }).notNull().default("AMFI"),
    category: text("category"), // e.g. "KYC", "Nomination", "Disclosure", "Commission", "Taxation"
    /** Plain-English summary for distributors. */
    summary: text("summary").notNull(),
    /** What the MFD must DO (the action), as bullet lines. */
    mfdAction: text("mfd_action"),
    /** Compliance deadline, if any. */
    effectiveOn: date("effective_on"),
    deadlineOn: date("deadline_on"),
    publishedOn: date("published_on"),
    sourceUrl: text("source_url"),
    severity: text("severity", { enum: ["info", "action_required", "critical"] }).notNull().default("info"),
    tags: jsonb("tags").$type<string[]>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    circularNoIdx: uniqueIndex("amfi_circulars_circular_no_idx").on(t.circularNo),
    publishedIdx: index("amfi_circulars_published_idx").on(t.publishedOn),
  })
);

export type AmfiCircular = typeof amfiCirculars.$inferSelect;
export type NewAmfiCircular = typeof amfiCirculars.$inferInsert;
