/**
 * Induction engine — enrolment, lesson completion + module unlocking, and
 * exam grading.
 *
 * Every function takes a tx already scoped by `withTenant`, so RLS applies.
 */

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  inductionAttempts,
  inductionEnrolments,
  inductionLessons,
  inductionProgress,
  inductionQuestions,
  inductionTracks,
  users,
  type InductionAttemptQuestion,
} from "@/db/schema";
import { SIDEBAR_REGISTRY } from "@/lib/nav/sidebar-registry";

/** A video counts as watched at 90% of its length, having reached the last 10%. */
const WATCH_COMPLETE_RATIO = 0.9;
const REACHED_END_RATIO = 0.9;

/** Only hrefs that actually exist in the sidebar registry may be unlocked. */
const KNOWN_MODULE_HREFS = new Set(SIDEBAR_REGISTRY.map((e) => e.href));

export function sanitizeModuleHrefs(hrefs: unknown): string[] {
  if (!Array.isArray(hrefs)) return [];
  return [...new Set(hrefs.filter((h): h is string => typeof h === "string" && KNOWN_MODULE_HREFS.has(h)))];
}

/**
 * Grant modules to a user by APPENDING to users.enabledModules.
 *
 * Deliberately additive and null-safe:
 *   - `enabledModules = null` means "no per-user restriction" (the default for
 *     most users). We must NOT convert that into a list, or induction would
 *     *remove* access from someone who currently sees everything.
 *   - We never remove an href.
 */
export async function grantModules(tx: any, userId: string, hrefs: string[]) {
  const clean = sanitizeModuleHrefs(hrefs);
  if (clean.length === 0) return;

  const row = (
    await tx.select({ enabled: users.enabledModules }).from(users).where(eq(users.id, userId)).limit(1)
  )[0];
  if (!row) return;
  // null = unrestricted; leave it alone rather than narrowing them to a list.
  if (row.enabled == null) return;

  const current: string[] = Array.isArray(row.enabled) ? row.enabled : [];
  const merged = [...new Set([...current, ...clean])];
  if (merged.length === current.length) return;

  await tx.update(users).set({ enabledModules: merged }).where(eq(users.id, userId));
}

/** The active track (if any) whose target_roles intersect the user's roles. */
export async function findTrackForRoles(tx: any, tenantId: string, roles: string[]) {
  const tracks = await tx
    .select()
    .from(inductionTracks)
    .where(and(eq(inductionTracks.tenantId, tenantId), eq(inductionTracks.status, "active")))
    .orderBy(asc(inductionTracks.createdAt));

  return (
    tracks.find((t: any) => {
      const targets: string[] = Array.isArray(t.targetRoles) ? t.targetRoles : [];
      return targets.length === 0 || targets.some((r) => roles.includes(r));
    }) ?? null
  );
}

/** Idempotent: enrol a user on a track, returning the enrolment row. */
export async function ensureEnrolment(
  tx: any,
  tenantId: string,
  trackId: string,
  userId: string,
  assignedByUserId?: string
) {
  const existing = (
    await tx
      .select()
      .from(inductionEnrolments)
      .where(and(eq(inductionEnrolments.trackId, trackId), eq(inductionEnrolments.userId, userId)))
      .limit(1)
  )[0];
  if (existing) return existing;

  return (
    await tx
      .insert(inductionEnrolments)
      .values({ tenantId, trackId, userId, assignedByUserId: assignedByUserId ?? null })
      .returning()
  )[0];
}

/**
 * Auto-enrol a user on the track matching their roles. Safe to call on every
 * login / invite-accept — it no-ops when there's no active track or the user is
 * already enrolled.
 */
export async function autoEnrol(tx: any, tenantId: string, userId: string, roles: string[]) {
  const track = await findTrackForRoles(tx, tenantId, roles);
  if (!track) return null;
  return ensureEnrolment(tx, tenantId, track.id, userId);
}

export type LessonState = {
  lesson: any;
  progress: any | null;
  locked: boolean;
  completed: boolean;
};

/**
 * The member's view of a track: lessons in order, each with progress and a
 * lock flag. A lesson unlocks when every previous REQUIRED lesson is done.
 */
export async function loadTrackState(tx: any, enrolmentId: string, trackId: string) {
  const lessons = await tx
    .select()
    .from(inductionLessons)
    .where(eq(inductionLessons.trackId, trackId))
    .orderBy(asc(inductionLessons.position));

  const progressRows = await tx
    .select()
    .from(inductionProgress)
    .where(eq(inductionProgress.enrolmentId, enrolmentId));
  const byLesson = new Map<string, any>(progressRows.map((p: any) => [p.lessonId, p]));

  let blocked = false;
  const states: LessonState[] = lessons.map((lesson: any) => {
    const progress = byLesson.get(lesson.id) ?? null;
    const completed = Boolean(progress?.completedAt);
    const state: LessonState = { lesson, progress, locked: blocked, completed };
    if (lesson.required && !completed) blocked = true;
    return state;
  });

  const requiredTotal = lessons.filter((l: any) => l.required).length;
  const requiredDone = states.filter((s) => s.lesson.required && s.completed).length;

  return {
    lessons: states,
    requiredTotal,
    requiredDone,
    allRequiredDone: requiredTotal > 0 && requiredDone === requiredTotal,
    percent: requiredTotal === 0 ? 0 : Math.round((requiredDone / requiredTotal) * 100),
  };
}

/** True when the watch counters satisfy the completion rule for this lesson. */
export function watchSatisfied(lesson: any, watched: number, maxPos: number) {
  const dur = Number(lesson.durationSeconds ?? 0);
  if (!dur) return true; // no known duration → trust the explicit "mark complete"
  return watched >= dur * WATCH_COMPLETE_RATIO && maxPos >= dur * REACHED_END_RATIO;
}

/**
 * Mark a lesson complete, grant its modules, and advance the enrolment status.
 * Returns the hrefs newly unlocked so the UI can tell the user what they got.
 */
export async function completeLesson(
  tx: any,
  opts: { tenantId: string; enrolmentId: string; trackId: string; lessonId: string; userId: string }
) {
  const lesson = (
    await tx
      .select()
      .from(inductionLessons)
      .where(and(eq(inductionLessons.id, opts.lessonId), eq(inductionLessons.trackId, opts.trackId)))
      .limit(1)
  )[0];
  if (!lesson) throw new Error("lesson not found");

  await tx
    .insert(inductionProgress)
    .values({
      tenantId: opts.tenantId,
      enrolmentId: opts.enrolmentId,
      lessonId: opts.lessonId,
      completedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [inductionProgress.enrolmentId, inductionProgress.lessonId],
      set: { completedAt: sql`COALESCE(${inductionProgress.completedAt}, now())`, updatedAt: new Date() },
    });

  const unlocked = sanitizeModuleHrefs(lesson.unlocksModules);
  await grantModules(tx, opts.userId, unlocked);

  const state = await loadTrackState(tx, opts.enrolmentId, opts.trackId);
  await tx
    .update(inductionEnrolments)
    .set({
      status: state.allRequiredDone ? "exam_ready" : "in_progress",
      startedAt: sql`COALESCE(${inductionEnrolments.startedAt}, now())`,
      updatedAt: new Date(),
    })
    .where(eq(inductionEnrolments.id, opts.enrolmentId));

  return { unlocked, state };
}

/** Fisher–Yates, seeded by nothing in particular — order only needs to vary. */
function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * Start an exam attempt. Freezes the question set (without correct answers)
 * onto the attempt row, so a reload can't reroll an easier paper.
 */
export async function startAttempt(
  tx: any,
  opts: { tenantId: string; enrolmentId: string; trackId: string }
) {
  const bank = await tx
    .select()
    .from(inductionQuestions)
    .where(and(eq(inductionQuestions.trackId, opts.trackId), eq(inductionQuestions.active, true)));
  if (bank.length === 0) throw new Error("no questions configured for this track");

  const prior = await tx
    .select()
    .from(inductionAttempts)
    .where(eq(inductionAttempts.enrolmentId, opts.enrolmentId))
    .orderBy(desc(inductionAttempts.attemptNo));

  const open = prior.find((a: any) => !a.submittedAt);
  if (open) return open; // resume, don't reroll

  const questions: InductionAttemptQuestion[] = shuffle(bank).map((q: any) => ({
    id: q.id,
    prompt: q.prompt,
    options: shuffle(Array.isArray(q.options) ? q.options : []),
    points: q.points ?? 1,
    lessonId: q.lessonId ?? null,
  }));

  return (
    await tx
      .insert(inductionAttempts)
      .values({
        tenantId: opts.tenantId,
        enrolmentId: opts.enrolmentId,
        attemptNo: (prior[0]?.attemptNo ?? 0) + 1,
        questions,
      })
      .returning()
  )[0];
}

/**
 * Grade a submission server-side. `correctKeys` never leaves the server, and
 * the answer key is re-read from the question bank rather than trusted from
 * the client payload.
 */
export async function gradeAttempt(
  tx: any,
  opts: { attempt: any; answers: Record<string, string[]>; passMark: number }
) {
  const frozen: InductionAttemptQuestion[] = Array.isArray(opts.attempt.questions)
    ? opts.attempt.questions
    : [];
  const ids = frozen.map((q) => q.id);
  if (ids.length === 0) throw new Error("attempt has no questions");

  const bank = await tx.select().from(inductionQuestions).where(inArray(inductionQuestions.id, ids));
  const byId = new Map(bank.map((q: any) => [q.id, q]));

  let earned = 0;
  let total = 0;
  const weakLessons = new Map<string, number>();

  for (const q of frozen) {
    const src: any = byId.get(q.id);
    if (!src) continue;
    const points = Number(src.points ?? 1);
    total += points;

    const correct = [...(Array.isArray(src.correctKeys) ? src.correctKeys : [])].sort();
    const given = [...new Set(opts.answers[q.id] ?? [])].sort();
    const ok = correct.length === given.length && correct.every((c, i) => c === given[i]);

    if (ok) earned += points;
    else if (src.lessonId) weakLessons.set(src.lessonId, (weakLessons.get(src.lessonId) ?? 0) + 1);
  }

  const scorePct = total === 0 ? 0 : Math.round((earned / total) * 10000) / 100;
  return {
    scorePct,
    passed: scorePct >= opts.passMark,
    weakLessonIds: [...weakLessons.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id),
  };
}
