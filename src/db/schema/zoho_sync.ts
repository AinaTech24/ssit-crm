import { bigint, index, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";

/**
 * Zoho CRM sync state.
 *
 * `zoho_sync_links` maps one of OUR records to its mirrored Zoho CRM record and
 * tracks the last sync outcome — so we can show "synced / failed" in the UI and
 * never create a duplicate (we upsert by external id, and store the resulting
 * Zoho id here for two-way linking later).
 *
 * `zoho_sync_state` is a per-tenant cursor into events_outbox so the sync poller
 * resumes exactly where it left off and never re-pushes an event twice.
 */
export const zohoSyncLinks = pgTable(
  "zoho_sync_links",
  {
    id,
    tenantId,
    /** Our entity type — "investor", "lead", … (matches events_outbox.entity_type). */
    entityType: text("entity_type").notNull(),
    /** Our record id (uuid stored as text — entity ids vary in type). */
    entityId: text("entity_id").notNull(),
    /** Target Zoho module — "Contacts", "Leads", … */
    zohoModule: text("zoho_module").notNull(),
    /** The Zoho record id, once the first successful upsert returns it. */
    zohoId: text("zoho_id"),
    status: text("status", { enum: ["pending", "synced", "error"] }).default("pending").notNull(),
    lastError: text("last_error"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => ({
    entityUnique: uniqueIndex("zoho_sync_links_entity_unique").on(t.tenantId, t.entityType, t.entityId),
    tenantStatusIdx: index("zoho_sync_links_tenant_status_idx").on(t.tenantId, t.status),
  })
);

export type ZohoSyncLink = typeof zohoSyncLinks.$inferSelect;

export const zohoSyncState = pgTable(
  "zoho_sync_state",
  {
    id,
    tenantId,
    /** Highest events_outbox.id this tenant has already pushed to Zoho. */
    lastOutboxId: bigint("last_outbox_id", { mode: "number" }).default(0).notNull(),
    /**
     * Per-module cursors for the table-polled modules (Tasks, Meetings,
     * Insurance, SIPs, …). Maps our entityType → "<updatedAt ISO>|<row id>" so
     * the engine resumes each module exactly where it left off. Outbox-driven
     * modules (investor, lead) keep using last_outbox_id above.
     */
    moduleCursors: jsonb("module_cursors").$type<Record<string, string>>().notNull().default({}),
    ...timestamps,
  },
  (t) => ({
    tenantUnique: uniqueIndex("zoho_sync_state_tenant_unique").on(t.tenantId),
  })
);

export type ZohoSyncState = typeof zohoSyncState.$inferSelect;
