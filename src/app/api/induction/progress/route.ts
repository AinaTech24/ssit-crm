/**
 * Video watch heartbeat + explicit lesson completion.
 *
 * The watch counters are a good-faith anti-skip measure, not proof of viewing —
 * the exam is the real assessment. We take max() of the reported values so a
 * late/duplicated beat can't reduce recorded progress.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { inductionEnrolments, inductionLessons, inductionProgress } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { completeLesson, watchSatisfied } from "@/lib/induction/engine";

export const dynamic = "force-dynamic";

const Body = z.object({
  lessonId: z.string().uuid(),
  watchedSeconds: z.number().int().min(0).max(60 * 60 * 12).optional(),
  positionSeconds: z.number().int().min(0).max(60 * 60 * 12).optional(),
  markComplete: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "induction.view", session.permissions);
    const input = Body.parse(await req.json());

    const result = await withTenant(session.tenantId, async (tx) => {
      // The enrolment is always resolved from the SESSION user — a member can
      // only ever write progress for their own track.
      const enrolment = (
        await tx
          .select()
          .from(inductionEnrolments)
          .where(eq(inductionEnrolments.userId, session.userId))
          .limit(1)
      )[0];
      if (!enrolment) return { error: "no induction assigned", status: 404 as const };

      const lesson = (
        await tx
          .select()
          .from(inductionLessons)
          .where(
            and(
              eq(inductionLessons.id, input.lessonId),
              eq(inductionLessons.trackId, enrolment.trackId)
            )
          )
          .limit(1)
      )[0];
      if (!lesson) return { error: "lesson not found", status: 404 as const };

      const existing = (
        await tx
          .select()
          .from(inductionProgress)
          .where(
            and(
              eq(inductionProgress.enrolmentId, enrolment.id),
              eq(inductionProgress.lessonId, lesson.id)
            )
          )
          .limit(1)
      )[0];

      const watched = Math.max(existing?.watchedSeconds ?? 0, input.watchedSeconds ?? 0);
      const maxPos = Math.max(existing?.maxPositionSeconds ?? 0, input.positionSeconds ?? 0);

      if (existing) {
        await tx
          .update(inductionProgress)
          .set({ watchedSeconds: watched, maxPositionSeconds: maxPos, updatedAt: new Date() })
          .where(eq(inductionProgress.id, existing.id));
      } else {
        await tx.insert(inductionProgress).values({
          tenantId: session.tenantId,
          enrolmentId: enrolment.id,
          lessonId: lesson.id,
          watchedSeconds: watched,
          maxPositionSeconds: maxPos,
        });
      }

      const alreadyDone = Boolean(existing?.completedAt);
      const eligible = watchSatisfied(lesson, watched, maxPos);

      if (!alreadyDone && input.markComplete) {
        if (!eligible) return { error: "watch the lesson through before marking it complete", status: 400 as const };
        const done = await completeLesson(tx, {
          tenantId: session.tenantId,
          enrolmentId: enrolment.id,
          trackId: enrolment.trackId,
          lessonId: lesson.id,
          userId: session.userId,
        });
        return { ok: true, completed: true, unlocked: done.unlocked, percent: done.state.percent };
      }

      return { ok: true, completed: alreadyDone, eligible, watchedSeconds: watched };
    });

    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result);
  } catch (err: any) {
    if (err?.name === "ZodError") {
      return NextResponse.json({ error: "invalid payload" }, { status: 400 });
    }
    const status = typeof err?.status === "number" ? err.status : 500;
    return NextResponse.json({ error: err?.message ?? "failed" }, { status });
  }
}
