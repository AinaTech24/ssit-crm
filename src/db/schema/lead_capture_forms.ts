/**
 * Lead capture forms — tenant-configurable public web forms.
 *
 * Each row defines one branded form. Public URL pattern:
 *   /lf/<form_slug>      (form_slug is globally unique — no tenant prefix
 *                         in the URL so MFDs can embed cleanly on their
 *                         own websites)
 *
 * Owners build a form once at /dashboard/settings/lead-forms; the form
 * resolves the tenant via the slug, validates required fields, and
 * POSTs a new lead with source='website' (default), assigned to either
 * a fixed RM or round-robin via the existing leads round-robin helper.
 *
 * Unlike share_tokens (single-use, single-subject), lead capture forms
 * are long-lived and many-submission. Disabling a form (enabled=false)
 * keeps the URL alive but returns 410 Gone — useful for retiring a form
 * gracefully without breaking inbound links from third-party sites.
 */

import { boolean, index, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";
import { tenants } from "./tenants";
import { users } from "./users";

export const leadCaptureForms = pgTable(
  "lead_capture_forms",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),

    /** Display name shown to the MFD in the admin UI. */
    name: text("name").notNull(),

    /** URL slug — globally unique. e.g. 'wealth-quickstart-bangalore'. */
    slug: text("slug").notNull(),

    description: text("description"),

    /**
     * Form field definitions. Defaults to the 4 universal fields
     * (name/email/phone/notes); MFDs can add extras like investment-goal
     * dropdown, occupation, source-of-funds, etc.
     *
     * Field schema:
     *   {
     *     key: 'occupation',
     *     label: 'Your occupation',
     *     type: 'text' | 'email' | 'tel' | 'number' | 'select' | 'textarea',
     *     required: boolean,
     *     options?: Array<{ value: string; label: string }>  // for select
     *     placeholder?: string,
     *   }
     */
    fields: jsonb("fields")
      .$type<
        Array<{
          key: string;
          label: string;
          type: "text" | "email" | "tel" | "number" | "select" | "textarea";
          required?: boolean;
          options?: Array<{ value: string; label: string }>;
          placeholder?: string;
        }>
      >()
      .default([]),

    /**
     * If set, every submission is assigned to this user. If null, the
     * leads round-robin picks one of the active RMs (same logic as
     * /api/leads POST).
     */
    defaultRmId: text("default_rm_id"),

    /** What source to stamp on the lead row. Defaults to 'website'. */
    leadSource: text("lead_source").notNull().default("website"),

    /** Tenant-defined source campaign string (for UTM-like attribution). */
    sourceCampaign: text("source_campaign"),

    /**
     * Branding overrides. If absent we render the tenant's primary colour
     * + display name + logo from the tenants row.
     */
    branding: jsonb("branding").$type<{
      primaryColor?: string;
      logoUrl?: string;
      thankYouMessage?: string;
      redirectUrl?: string;
    }>(),

    /**
     * False = form URL returns 410 Gone. Tenant can re-enable any time;
     * useful for retiring a campaign without breaking inbound links.
     */
    enabled: boolean("enabled").notNull().default(true),

    /** Simple rate-limit knob — submissions per IP per hour. */
    rateLimitPerHour: text("rate_limit_per_hour").default("5"),

    /** Audit. */
    createdBy: text("created_by"),

    ...timestamps,
  },
  (t) => ({
    slugUnique: uniqueIndex("lead_capture_forms_slug_unique").on(t.slug),
    tenantIdx: index("lead_capture_forms_tenant_idx").on(t.tenantId, t.enabled),
  })
);

// (foreign keys are skipped on createdBy/defaultRmId to avoid migration
// complexity — the API layer validates these IDs against the tenant)

export type LeadCaptureForm = typeof leadCaptureForms.$inferSelect;
export type NewLeadCaptureForm = typeof leadCaptureForms.$inferInsert;

// Suppress unused-import warning for users — kept available for future FK.
void users;
