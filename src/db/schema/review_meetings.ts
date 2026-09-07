/**
 * Review Meetings — spec § Module 12.
 *
 * One row per scheduled or completed client review meeting.
 *
 * When a meeting is marked `completed`, the API:
 *   - stamps `actualEndAt` (defaults to now)
 *   - updates the investor's `lastReviewAt` to the meeting date and
 *     `nextReviewAt` to next_review_date (cadence per service tier)
 *   - fans out `actionItems[]` into individual `tasks` rows assigned to the RM
 *   - flips `followUpTaskCreated = true` so the UI shows the linkage
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

/**
 * High-level meeting category. Drives the workflow:
 *   - 'review'      → marks investor.lastReviewAt + nextReviewAt on completion
 *   - 'new'         → first-time meeting (discovery / kickoff / sales pitch)
 *   - 'follow_up'   → references a parent meeting via `parentMeetingId`
 */
export const MEETING_CATEGORIES = ["review", "new", "follow_up"] as const;

/** Specific agenda for the meeting. Extended with new/follow-up flavors. */
export const REVIEW_MEETING_TYPES = [
  // Review-flavored
  "portfolio_review",
  "goal_review",
  "service_discussion",
  "family_review",
  "complaint_discussion",
  // New-meeting flavored
  "discovery_call",
  "new_client_kickoff",
  "new_investment_discussion",
  "product_demo",
  "sales_pitch",
  // Follow-up flavored
  "follow_up_call",
  "follow_up_visit",
  // Other
  "other",
] as const;

export const REVIEW_MEETING_MODES = [
  "office",
  "client_place",
  "online",
  "phone",
] as const;

export const REVIEW_MEETING_STATUSES = [
  "scheduled",
  "confirmed",
  "in_progress",
  "completed",
  "rescheduled",
  "cancelled",
  "no_show",
] as const;

/** Post-meeting outcome — captured after the meeting, drives the next stage
 *  in the lead-to-client funnel. */
export const REVIEW_MEETING_OUTCOMES = [
  "ready",        // Client confirmed they want to proceed
  "more_info",    // Wants more information / time to think
  "not_ready",    // Not ready right now (re-nurture)
  "not_interested", // Hard no — close lead
  "no_show",      // Did not attend (also reflected in status)
] as const;

export const reviewMeetings = pgTable(
  "review_meetings",
  {
    id,
    tenantId,
    /**
     * Subject of the meeting — exactly one of investorId / leadId is set.
     * MFDs frequently meet leads pre-conversion (discovery, proposal review),
     * so we accept either. A DB CHECK constraint enforces XOR.
     */
    investorId: uuid("investor_id"),
    leadId: uuid("lead_id"),
    /** Family-level review (when set, investorId points at the primary). */
    familyId: uuid("family_id"),
    /**
     * DEPRECATED — superseded by createdById. Kept so historical rows retain who
     * owned them; nothing reads it. See 0203_meeting_creator_and_collaborators.
     */
    rmId: uuid("rm_id"),
    /** Meeting owner: drives access control AND inherits fanned-out action items. */
    createdById: uuid("created_by_id"),
    /** Everyone else invited alongside the creator. */
    collaboratorIds: jsonb("collaborator_ids").$type<string[]>().notNull().default([]),

    /**
     * High-level category — review / new / follow_up. Defaults to 'review'
     * for back-compat with rows seeded before this revision.
     */
    category: text("category", { enum: MEETING_CATEGORIES }).notNull().default("review"),
    /** When category='follow_up' this points at the original meeting. */
    parentMeetingId: uuid("parent_meeting_id"),

    meetingType: text("meeting_type", { enum: REVIEW_MEETING_TYPES }).notNull(),
    /** Optional free-text headline (Sanchay-parity). Falls back to type + name. */
    subject: text("subject"),
    meetingDate: timestamp("meeting_date", { withTimezone: true }).notNull(),
    durationMinutes: text("duration_minutes").default("30"),
    meetingMode: text("meeting_mode", { enum: REVIEW_MEETING_MODES }).notNull(),
    locationOrLink: text("location_or_link"),

    status: text("status", { enum: REVIEW_MEETING_STATUSES }).notNull().default("scheduled"),

    /** Captured after the meeting — drives whether the lead progresses to
     *  risk profile / proposal / nurture / close. */
    outcome: text("outcome", { enum: REVIEW_MEETING_OUTCOMES }),
    outcomeNotes: text("outcome_notes"),

    /** Free text — agenda set ahead of the meeting. */
    discussionPoints: text("discussion_points"),

    /**
     * Post-meeting fields — filled by the RM after the meeting.
     * `actionItems` is an array of { title, assigneeId?, dueAt?, taskId? }
     * entries. When taskId is set, that task was auto-created.
     */
    meetingNotes: text("meeting_notes"),
    actionItems: jsonb("action_items").$type<
      Array<{ title: string; assigneeId?: string; dueAt?: string; taskId?: string }>
    >().default([]),

    /**
     * Network FP "2.5 MOM Tracker" attendees list — beyond just RM +
     * investor. Captures spouse / family / CA / AMC RM / sub-distributor
     * / back-office / compliance presence so the per-client meeting
     * history shows who was actually in the room.
     */
    attendees: jsonb("attendees").$type<
      Array<{
        name: string;
        role:
          | "rm"
          | "investor"
          | "spouse"
          | "family"
          | "ca"
          | "amc_rm"
          | "sub_distributor"
          | "back_office"
          | "compliance"
          | "other";
        isExternal: boolean;
        notes?: string;
      }>
    >().default([]),
    attachments: jsonb("attachments").$type<
      Array<{ name: string; url: string; size?: number; uploadedAt?: string }>
    >().default([]),

    nextReviewDate: date("next_review_date"),
    actualEndAt: timestamp("actual_end_at", { withTimezone: true }),

    /** Reschedule bookkeeping — how many times moved + the latest reason. */
    rescheduleCount: integer("reschedule_count").notNull().default(0),
    rescheduleReason: text("reschedule_reason"),

    /** True once action items have been fanned out into the tasks table. */
    followUpTaskCreated: text("follow_up_task_created").default("false"),
    /** Reminder + post-meeting notification task ids (so we don't duplicate). */
    reminderTaskId: uuid("reminder_task_id"),
    notesReminderTaskId: uuid("notes_reminder_task_id"),

    ...timestamps,
  },
  (t) => ({
    investorIdx: index("rm_investor_idx").on(t.tenantId, t.investorId, t.meetingDate),
    statusIdx: index("rm_status_idx").on(t.tenantId, t.status, t.meetingDate),
    rmIdx: index("rm_rm_idx").on(t.tenantId, t.rmId, t.meetingDate),
    createdByIdx: index("rm_created_by_idx").on(t.tenantId, t.createdById, t.meetingDate),
    dateIdx: index("rm_date_idx").on(t.tenantId, t.meetingDate),
    categoryIdx: index("rm_category_idx").on(t.tenantId, t.category, t.meetingDate),
    parentIdx: index("rm_parent_idx").on(t.parentMeetingId),
  })
);

export type ReviewMeeting = typeof reviewMeetings.$inferSelect;
export type NewReviewMeeting = typeof reviewMeetings.$inferInsert;
