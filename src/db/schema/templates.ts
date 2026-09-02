import { boolean, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";
import { tenants } from "./tenants";
import { users } from "./users";

/**
 * Channel-agnostic logical template. Versions hold the channel-specific body.
 */
export const templates = pgTable(
  "templates",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),

    /** Logical identifier referenced by workflows. Stable across versions. */
    key: text("key").notNull(),
    channel: text("channel", { enum: ["whatsapp", "email", "sms", "inapp"] }).notNull(),
    name: text("name").notNull(),
    description: text("description"),

    /** Category drives compliance ruleset:
     *  - transactional/utility: confirmations, OTPs, status updates
     *  - marketing: requires opt-in, ARN tagline, etc.
     *  - authentication: WA-specific, OTP only */
    category: text("category", {
      enum: ["transactional", "utility", "marketing", "authentication"],
    })
      .notNull()
      .default("transactional"),

    locale: text("locale").notNull().default("en-IN"),

    currentVersionId: uuid("current_version_id"),
    status: text("status", {
      enum: ["draft", "pending_approval", "approved", "rejected", "paused", "archived"],
    })
      .notNull()
      .default("draft"),
    ...timestamps,
  },
  (t) => ({
    keyUnique: uniqueIndex("templates_tenant_key_channel_locale_unique").on(
      t.tenantId,
      t.key,
      t.channel,
      t.locale
    ),
    statusIdx: index("templates_status_idx").on(t.tenantId, t.status),
  })
);

export const templateVersions = pgTable(
  "template_versions",
  {
    id,
    templateId: uuid("template_id")
      .notNull()
      .references(() => templates.id, { onDelete: "cascade" }),
    tenantId: tenantId.references(() => tenants.id),
    versionNumber: integer("version_number").notNull(),

    /**
     * Channel-specific body. Shape depends on `templates.channel`:
     *
     * WhatsApp:
     *   { header?: {...}, body: { text: "..." }, footer?: {...},
     *     buttons?: [...], components?: [...] (Wapi format) }
     *
     * Email:
     *   { subject: "...", preheader?: "...", blocks: [
     *       { type: "header"|"hero"|"text"|"button"|"divider"|"footer", ... }
     *     ], textFallback: "..." }
     *
     * SMS:
     *   { dltTemplateId: "...", text: "..." }
     */
    body: jsonb("body").notNull(),

    /** Typed variable declarations */
    variables: jsonb("variables")
      .$type<Array<{
        key: string;
        type: "string" | "number" | "currency" | "date" | "boolean" | "url";
        source?: string; // dotted path like 'investor.name' or 'context.amount'
        required?: boolean;
        fallback?: unknown;
        format?: string; // 'inr', 'date_long', etc.
      }>>()
      .notNull()
      .default([]),

    /** Files that auto-attach on send (email). Each: { name, url }. */
    attachments: jsonb("attachments")
      .$type<Array<{ name: string; url: string }>>()
      .notNull()
      .default([]),

    /** Last compliance scan output */
    complianceChecks: jsonb("compliance_checks"),
    complianceScore: numeric("compliance_score", { precision: 5, scale: 2 }),
    autoComplianceBlocked: boolean("auto_compliance_blocked").default(false),

    /** Author of this version — used for maker-checker (an author may not be
     *  the approver of their own version). */
    createdByUserId: uuid("created_by_user_id").references(() => users.id),

    /** Approval pipeline */
    approvalStatus: text("approval_status", {
      enum: ["draft", "submitted", "approved_internal", "approved_external", "rejected"],
    })
      .notNull()
      .default("draft"),
    approvedByUserId: uuid("approved_by_user_id").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    rejectionReason: text("rejection_reason"),

    /** External reference (e.g. Wapi/Meta template id, SES template name) */
    externalRef: text("external_ref"),
    externalStatus: text("external_status"),
    externalSyncedAt: timestamp("external_synced_at", { withTimezone: true }),

    ...timestamps,
  },
  (t) => ({
    versionUnique: uniqueIndex("tpl_versions_unique").on(t.templateId, t.versionNumber),
  })
);

export const templateApprovals = pgTable("template_approvals", {
  id,
  templateVersionId: uuid("template_version_id")
    .notNull()
    .references(() => templateVersions.id, { onDelete: "cascade" }),
  tenantId: tenantId.references(() => tenants.id),
  step: text("step", {
    enum: ["auto_compliance", "compliance_officer", "amc", "meta"],
  }).notNull(),
  decision: text("decision", { enum: ["approved", "rejected", "pending"] })
    .notNull()
    .default("pending"),
  notes: text("notes"),
  decidedByUserId: uuid("decided_by_user_id").references(() => users.id),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  ...timestamps,
});

/** WhatsApp-specific template metadata synced from Wapi / Meta. */
export const whatsappTemplates = pgTable(
  "whatsapp_templates",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    templateId: uuid("template_id").references(() => templates.id),
    metaTemplateName: text("meta_template_name").notNull(),
    metaLanguage: text("meta_language").notNull().default("en"),
    category: text("category", { enum: ["MARKETING", "UTILITY", "AUTHENTICATION"] }).notNull(),
    metaStatus: text("meta_status", {
      enum: ["PENDING", "APPROVED", "REJECTED", "PAUSED", "DISABLED"],
    }).notNull(),
    metaRejectionReason: text("meta_rejection_reason"),
    components: jsonb("components").notNull(),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => ({
    nameUnique: uniqueIndex("wa_templates_unique").on(t.tenantId, t.metaTemplateName, t.metaLanguage),
    statusIdx: index("wa_templates_status_idx").on(t.tenantId, t.metaStatus),
  })
);

export type Template = typeof templates.$inferSelect;
export type TemplateVersion = typeof templateVersions.$inferSelect;
export type TemplateApproval = typeof templateApprovals.$inferSelect;
export type WhatsappTemplate = typeof whatsappTemplates.$inferSelect;
