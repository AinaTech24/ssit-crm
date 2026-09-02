/**
 * Tenant-editable risk-profile templates.
 *
 * Each MFD can publish its own questionnaire (questions + options + scores +
 * category bands). The template applies to every new risk-profile capture
 * from the moment it's published. Historical `risk_profile_responses` rows
 * are immutable — they keep the questions/scores frozen at the time they
 * were captured.
 *
 * Versioning model:
 *   - One row per (tenantId, versionNumber).
 *   - `is_active = true` on the currently-published version.
 *   - Edits create a new version row + flip is_active.
 *
 * When no row exists for a tenant, the API falls back to the seed default
 * in src/lib/risk-profile/questions.ts.
 */

import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";
import { tenants } from "./tenants";
import { users } from "./users";

export const riskProfileTemplates = pgTable(
  "risk_profile_templates",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),

    versionNumber: integer("version_number").notNull().default(1),
    isActive: boolean("is_active").notNull().default(true),

    /** Human-friendly name shown in the editor (defaults to "Risk profile v<n>"). */
    name: text("name").notNull().default("Risk profile"),
    description: text("description"),

    /**
     * Questions array. Each entry:
     *   { key, label, helperText?, type: "single", options: [{ value, label, score }] }
     * Reuses the seed shape from src/lib/risk-profile/questions.ts.
     */
    questions: jsonb("questions").notNull(),

    /**
     * Category bands. Array of:
     *   { id, label, minScore, maxScore, color?, description? }
     * The first band whose [minScore..maxScore] contains the total wins.
     */
    bands: jsonb("bands").notNull(),

    /** Annual review reminder window — auto-bumps `next_review_at` on save. */
    reviewIntervalDays: integer("review_interval_days").notNull().default(365),

    /**
     * Require email-OTP verification when a CLIENT submits the public
     * /r/<token> form. When true, the submit route rejects without a verified
     * 6-digit code and stamps verified_email/email_verified_at on the response.
     */
    requireEmailOtp: boolean("require_email_otp").notNull().default(true),

    publishedBy: uuid("published_by").references(() => users.id),
    publishedAt: timestamp("published_at", { withTimezone: true }).defaultNow(),

    ...timestamps,
  },
  (t) => ({
    versionUnique: uniqueIndex("rpt_tenant_version_unique").on(t.tenantId, t.versionNumber),
    activeIdx: index("rpt_active_idx").on(t.tenantId, t.isActive),
  })
);

export type RiskProfileTemplate = typeof riskProfileTemplates.$inferSelect;
export type NewRiskProfileTemplate = typeof riskProfileTemplates.$inferInsert;
