/**
 * Exam: start an attempt (POST ?action=start) and submit it (?action=submit).
 *
 * Answer keys never leave the server: the attempt row stores the question set
 * WITHOUT `correctKeys`, and grading re-reads the key from the question bank
 * rather than trusting anything in the request.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { randomBytes } from "crypto";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { inductionAttempts, inductionEnrolments, inductionTracks } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { gradeAttempt, loadTrackState, startAttempt } from "@/lib/induction/engine";

export const dynamic = "force-dynamic";

const SubmitBody = z.object({
  attemptId: z.string().uuid(),
  answers: z.record(z.array(z.string())),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "induction.view", session.permissions);
    const action = new URL(req.url).searchParams.get("action") ?? "start";

    const result = await withTenant(session.tenantId, async (tx) => {
      const enrolment = (
        await tx
          .select()
          .from(inductionEnrolments)
          .where(eq(inductionEnrolments.userId, session.userId))
          .limit(1)
      )[0];
      if (!enrolment) return { error: "no induction assigned", status: 404 as const };

      const track = (
        await tx.select().from(inductionTracks).where(eq(inductionTracks.id, enrolment.trackId)).limit(1)
      )[0];
      if (!track) return { error: "track not found", status: 404 as const };

      if (action === "start") {
        const state = await loadTrackState(tx, enrolment.id, enrolment.trackId);
        if (!state.allRequiredDone) {
          return { error: "finish every required lesson before the exam", status: 400 as const };
        }

        // Attempt cap + cooldown.
        const prior = await tx
          .select()
          .from(inductionAttempts)
          .where(eq(inductionAttempts.enrolmentId, enrolment.id))
          .orderBy(desc(inductionAttempts.attemptNo));
        const submitted = prior.filter((a: any) => a.submittedAt);

        if (track.maxAttempts != null && submitted.length >= track.maxAttempts) {
          return {
            error: "You've used all attempts. Your manager has been notified and can reset this.",
            status: 429 as const,
          };
        }
        const last = submitted[0];
        if (last?.submittedAt && !last.passed) {
          const readyAt = new Date(new Date(last.submittedAt).getTime() + track.cooldownHours * 3600_000);
          if (readyAt > new Date()) {
            return { error: `Next attempt available at ${readyAt.toISOString()}`, status: 429 as const };
          }
        }

        const attempt = await startAttempt(tx, {
          tenantId: session.tenantId,
          enrolmentId: enrolment.id,
          trackId: enrolment.trackId,
        });
        return {
          ok: true,
          attemptId: attempt.id,
          attemptNo: attempt.attemptNo,
          passMark: track.passMark,
          questions: attempt.questions,
        };
      }

      // ── submit ──
      const body = SubmitBody.parse(await req.json());
      const attempt = (
        await tx
          .select()
          .from(inductionAttempts)
          .where(
            and(
              eq(inductionAttempts.id, body.attemptId),
              eq(inductionAttempts.enrolmentId, enrolment.id)
            )
          )
          .limit(1)
      )[0];
      if (!attempt) return { error: "attempt not found", status: 404 as const };
      if (attempt.submittedAt) return { error: "attempt already submitted", status: 400 as const };

      const graded = await gradeAttempt(tx, {
        attempt,
        answers: body.answers,
        passMark: track.passMark,
      });

      await tx
        .update(inductionAttempts)
        .set({
          submittedAt: new Date(),
          answers: body.answers,
          scorePct: String(graded.scorePct),
          passed: graded.passed,
          updatedAt: new Date(),
        })
        .where(eq(inductionAttempts.id, attempt.id));

      if (graded.passed) {
        const token = randomBytes(32).toString("base64url");
        const validUntil = track.validDays
          ? new Date(Date.now() + track.validDays * 86400_000)
          : null;
        await tx
          .update(inductionEnrolments)
          .set({
            status: "passed",
            completedAt: new Date(),
            validUntil,
            letterToken: track.issueLetter ? token : null,
            letterIssuedAt: track.issueLetter ? new Date() : null,
            updatedAt: new Date(),
          })
          .where(eq(inductionEnrolments.id, enrolment.id));

        return {
          ok: true,
          passed: true,
          scorePct: graded.scorePct,
          letterUrl: track.issueLetter ? `/induction/letter/${token}` : null,
        };
      }

      await tx
        .update(inductionEnrolments)
        .set({ status: "failed", updatedAt: new Date() })
        .where(eq(inductionEnrolments.id, enrolment.id));

      return {
        ok: true,
        passed: false,
        scorePct: graded.scorePct,
        passMark: track.passMark,
        weakLessonIds: graded.weakLessonIds,
      };
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
