/**
 * Activities — the unified interaction log (Sanchay "Calls" + field-visit
 * "Check In" parity, generalised).
 *
 * One row per logged touchpoint against a client / lead / family:
 *   - kind 'call'    → a phone call (direction + status + duration)
 *   - kind 'visit'   → an in-person field visit ("Check In": geo + time)
 *   - kind 'note'    → a free-form interaction note
 *   - kind 'whatsapp'/'email'/'sms' → a manually-logged message touch
 *
 * Subject is polymorphic (investor | lead | family) with a denormalised
 * subjectName/subjectPhone so the list renders without joins and a row
 * survives the subject being edited. Meetings have their own richer module
 * (review_meetings); this is the lightweight "what happened" feed.
 */

import { index, numeric, pgTable, text, timestamp, integer, uuid } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";

export const ACTIVITY_KINDS = ["call", "visit", "note", "whatsapp", "email", "sms", "other"] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export const ACTIVITY_DIRECTIONS = ["outbound", "inbound"] as const;
export type ActivityDirection = (typeof ACTIVITY_DIRECTIONS)[number];

/** Call-style outcome (also reused loosely for visits = 'completed'/'no_show'). */
export const ACTIVITY_STATUSES = [
  "completed",
  "answered",
  "no_answer",
  "busy",
  "failed",
  "left_voicemail",
  "no_show",
] as const;
export type ActivityStatus = (typeof ACTIVITY_STATUSES)[number];

export const ACTIVITY_SUBJECT_TYPES = ["investor", "lead", "family"] as const;
export type ActivitySubjectType = (typeof ACTIVITY_SUBJECT_TYPES)[number];

export const activities = pgTable(
  "activities",
  {
    id,
    tenantId,
    branchId: uuid("branch_id"),

    /** Polymorphic subject — the client/lead/family this touch is about. */
    subjectType: text("subject_type", { enum: ACTIVITY_SUBJECT_TYPES }).notNull(),
    subjectId: uuid("subject_id").notNull(),
    /** Denormalised for list rendering + audit durability. */
    subjectName: text("subject_name"),
    subjectPhone: text("subject_phone"),

    kind: text("kind", { enum: ACTIVITY_KINDS }).notNull().default("call"),
    direction: text("direction", { enum: ACTIVITY_DIRECTIONS }),
    status: text("status", { enum: ACTIVITY_STATUSES }),

    /** One-line summary ("SIP top-up discussion", "KYC docs collected"). */
    subject: text("subject"),
    /** Outcome / notes captured by the RM. */
    notes: text("notes"),

    /** When the interaction actually happened (not when it was logged). */
    occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
    /** Call duration in seconds (null for non-calls). */
    durationSec: integer("duration_sec"),

    /** Field-visit "Check In" geo capture (kind = 'visit'). */
    geoLat: numeric("geo_lat", { precision: 10, scale: 6 }),
    geoLng: numeric("geo_lng", { precision: 10, scale: 6 }),
    locationLabel: text("location_label"),

    /** Optional next follow-up the RM wants to be reminded about. */
    nextFollowupAt: timestamp("next_followup_at", { withTimezone: true }),

    /** Who logged / owns this activity (the RM). */
    ownerUserId: uuid("owner_user_id"),

    ...timestamps,
  },
  (t) => ({
    subjectIdx: index("activities_subject_idx").on(t.tenantId, t.subjectType, t.subjectId, t.occurredAt),
    kindIdx: index("activities_kind_idx").on(t.tenantId, t.kind, t.occurredAt),
    ownerIdx: index("activities_owner_idx").on(t.tenantId, t.ownerUserId, t.occurredAt),
    occurredIdx: index("activities_occurred_idx").on(t.tenantId, t.occurredAt),
    followupIdx: index("activities_followup_idx").on(t.tenantId, t.nextFollowupAt),
  })
);

export type Activity = typeof activities.$inferSelect;
export type NewActivity = typeof activities.$inferInsert;
