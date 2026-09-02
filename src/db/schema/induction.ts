/**
 * Induction — team-member training tracks, progress, exam and confirmation letter.
 *
 * NOT to be confused with `onboarding.ts`, which is *client* onboarding
 * (investor pipelines). "Employees" in this product is a view over `users`, so
 * enrolments key on users(id).
 *
 * Access unlocking: each lesson carries `unlocksModules` — sidebar hrefs from
 * SIDEBAR_REGISTRY. Completing the lesson appends them to `users.enabledModules`,
 * which the dashboard layout already uses to filter the sidebar.
 *
 * That is NAVIGATION filtering, not authorisation — every API route still
 * enforces its own capability check. Induction gating exists so a new joiner
 * isn't shown 60 modules on day one; it is not a way to withhold data.
 */

import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";

export const INDUCTION_LESSON_KINDS = [
  "video",
  "document",
  "kb_article",
  "link",
  "checklist",
] as const;
export type InductionLessonKind = (typeof INDUCTION_LESSON_KINDS)[number];

export const INDUCTION_STATUSES = [
  "not_started",
  "in_progress",
  "exam_ready",
  "passed",
  "failed",
] as const;
export type InductionStatus = (typeof INDUCTION_STATUSES)[number];

export type InductionOption = { key: string; text: string };

/** A question as sent to the client — deliberately without `correctKeys`. */
export type InductionAttemptQuestion = {
  id: string;
  prompt: string;
  options: InductionOption[];
  points: number;
  lessonId: string | null;
};

export const inductionTracks = pgTable(
  "induction_tracks",
  {
    id,
    tenantId,
    name: text("name").notNull(),
    description: text("description"),
    targetRoles: jsonb("target_roles").$type<string[]>().notNull().default([]),
    passMark: integer("pass_mark").notNull().default(70),
    maxAttempts: integer("max_attempts"),
    cooldownHours: integer("cooldown_hours").notNull().default(24),
    issueLetter: boolean("issue_letter").notNull().default(true),
    blockUntilPassed: boolean("block_until_passed").notNull().default(false),
    validDays: integer("valid_days"),
    status: text("status").notNull().default("draft"),
    createdBy: uuid("created_by"),
    ...timestamps,
  },
  (t) => ({ tenantIdx: index("induction_tracks_tenant_idx").on(t.tenantId, t.status) })
);

export const inductionLessons = pgTable(
  "induction_lessons",
  {
    id,
    tenantId,
    trackId: uuid("track_id").notNull(),
    position: integer("position").notNull(),
    title: text("title").notNull(),
    summary: text("summary"),
    kind: text("kind").$type<InductionLessonKind>().notNull().default("video"),
    videoKey: text("video_key"),
    videoUrl: text("video_url"),
    durationSeconds: integer("duration_seconds"),
    docKey: text("doc_key"),
    kbArticleId: uuid("kb_article_id"),
    bodyMd: text("body_md"),
    unlocksModules: jsonb("unlocks_modules").$type<string[]>().notNull().default([]),
    required: boolean("required").notNull().default(true),
    ...timestamps,
  },
  (t) => ({
    posIdx: uniqueIndex("induction_lessons_pos_idx").on(t.trackId, t.position),
    tenantIdx: index("induction_lessons_tenant_idx").on(t.tenantId, t.trackId),
  })
);

export const inductionEnrolments = pgTable(
  "induction_enrolments",
  {
    id,
    tenantId,
    trackId: uuid("track_id").notNull(),
    userId: uuid("user_id").notNull(),
    status: text("status").$type<InductionStatus>().notNull().default("not_started"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    validUntil: timestamp("valid_until", { withTimezone: true }),
    letterIssuedAt: timestamp("letter_issued_at", { withTimezone: true }),
    letterToken: text("letter_token"),
    assignedByUserId: uuid("assigned_by_user_id"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => ({
    uniq: uniqueIndex("induction_enrolments_uniq").on(t.trackId, t.userId),
    tenantIdx: index("induction_enrolments_tenant_idx").on(t.tenantId, t.userId, t.status),
  })
);

export const inductionProgress = pgTable(
  "induction_progress",
  {
    id,
    tenantId,
    enrolmentId: uuid("enrolment_id").notNull(),
    lessonId: uuid("lesson_id").notNull(),
    watchedSeconds: integer("watched_seconds").notNull().default(0),
    maxPositionSeconds: integer("max_position_seconds").notNull().default(0),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => ({
    uniq: uniqueIndex("induction_progress_uniq").on(t.enrolmentId, t.lessonId),
    tenantIdx: index("induction_progress_tenant_idx").on(t.tenantId, t.enrolmentId),
  })
);

export const inductionQuestions = pgTable(
  "induction_questions",
  {
    id,
    tenantId,
    trackId: uuid("track_id").notNull(),
    lessonId: uuid("lesson_id"),
    prompt: text("prompt").notNull(),
    options: jsonb("options").$type<InductionOption[]>().notNull().default([]),
    correctKeys: jsonb("correct_keys").$type<string[]>().notNull().default([]),
    explanation: text("explanation"),
    points: integer("points").notNull().default(1),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (t) => ({ tenantIdx: index("induction_questions_tenant_idx").on(t.tenantId, t.trackId, t.active) })
);

export const inductionAttempts = pgTable(
  "induction_attempts",
  {
    id,
    tenantId,
    enrolmentId: uuid("enrolment_id").notNull(),
    attemptNo: integer("attempt_no").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    questions: jsonb("questions").$type<InductionAttemptQuestion[]>().notNull().default([]),
    answers: jsonb("answers").$type<Record<string, string[]>>().notNull().default({}),
    scorePct: numeric("score_pct", { precision: 5, scale: 2 }),
    passed: boolean("passed"),
    ...timestamps,
  },
  (t) => ({
    uniq: uniqueIndex("induction_attempts_uniq").on(t.enrolmentId, t.attemptNo),
    tenantIdx: index("induction_attempts_tenant_idx").on(t.tenantId, t.enrolmentId),
  })
);
