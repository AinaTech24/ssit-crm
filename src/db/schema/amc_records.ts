import { date, index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";
import { tenants } from "./tenants";
import { users } from "./users";
import { amcEmpanelments } from "./amc_empanelments";

/**
 * The running record of a relationship with an AMC: what was discussed, and
 * what somebody wants remembered.
 *
 * An empanelment row is a STATUS — codes, contacts, dates, whether the firm is
 * still on the panel. It says nothing about the relationship itself: the
 * quarterly review that happened, the commission the RM promised to check, the
 * product manager who is leaving. That lived in people's inboxes.
 *
 * Two tables rather than one with a `kind` column, because the shapes genuinely
 * differ — a meeting has a date, attendees and an agenda that a note does not,
 * and folding them together means half the columns are null on every row.
 */

export const amcMeetings = pgTable(
  "amc_meetings",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    amcEmpanelmentId: uuid("amc_empanelment_id")
      .notNull()
      .references(() => amcEmpanelments.id, { onDelete: "cascade" }),

    meetingDate: date("meeting_date").notNull(),
    /** Free text: "Quarterly review", "Product launch briefing". */
    subject: text("subject").notNull(),
    /** Who was there, from both sides. Free text — an AMC's attendees are not
     *  users of this CRM, so a picker would be the wrong shape. */
    attendees: text("attendees"),
    /** What was discussed and agreed. */
    notes: text("notes"),
    /** What the firm has to do next, if anything. */
    followUp: text("follow_up"),

    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    ...timestamps,
  },
  (t) => ({
    amcIdx: index("amc_meetings_amc_idx").on(t.tenantId, t.amcEmpanelmentId, t.meetingDate),
  })
);

export type AmcMeeting = typeof amcMeetings.$inferSelect;
export type NewAmcMeeting = typeof amcMeetings.$inferInsert;

export const amcNotes = pgTable(
  "amc_notes",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    amcEmpanelmentId: uuid("amc_empanelment_id")
      .notNull()
      .references(() => amcEmpanelments.id, { onDelete: "cascade" }),

    note: text("note").notNull(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    /** When it was recorded — separate from created_at so a note can be
     *  back-dated to the day it actually refers to. */
    notedOn: date("noted_on"),
    ...timestamps,
  },
  (t) => ({
    amcIdx: index("amc_notes_amc_idx").on(t.tenantId, t.amcEmpanelmentId, t.createdAt),
  })
);

export type AmcNote = typeof amcNotes.$inferSelect;
export type NewAmcNote = typeof amcNotes.$inferInsert;

/** Kept so a caller can type a combined feed without importing both. */
export type AmcRecordKind = "meeting" | "note";
