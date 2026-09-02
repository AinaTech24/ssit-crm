/**
 * A single induction lesson. Enforces the same lock rule as the track page —
 * a member cannot deep-link past a required step they haven't finished.
 */

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { withTenant } from "@/db/client";
import { inductionEnrolments, inductionLessons, inductionProgress } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { loadTrackState } from "@/lib/induction/engine";
import { isS3Configured, presignedGetUrl } from "@/lib/storage/s3";
import { LessonPlayer } from "@/components/induction/LessonPlayer";

export const dynamic = "force-dynamic";

export default async function LessonPage({
  params,
}: {
  params: Promise<{ lessonId: string }>;
}) {
  const { lessonId } = await params;
  const session = await requireSession();

  const data = await withTenant(session.tenantId, async (tx) => {
    const [enrolment] = await tx
      .select()
      .from(inductionEnrolments)
      .where(eq(inductionEnrolments.userId, session.userId))
      .limit(1);
    if (!enrolment) return null;

    const [lesson] = await tx
      .select()
      .from(inductionLessons)
      .where(
        and(eq(inductionLessons.id, lessonId), eq(inductionLessons.trackId, enrolment.trackId))
      )
      .limit(1);
    if (!lesson) return null;

    const state = await loadTrackState(tx, enrolment.id, enrolment.trackId);
    const mine = state.lessons.find((s: any) => s.lesson.id === lessonId);

    const [progress] = await tx
      .select()
      .from(inductionProgress)
      .where(
        and(
          eq(inductionProgress.enrolmentId, enrolment.id),
          eq(inductionProgress.lessonId, lessonId)
        )
      )
      .limit(1);

    return { lesson, locked: mine?.locked ?? false, completed: Boolean(progress?.completedAt), progress };
  });

  if (!data) notFound();
  // Deep-link guard: the lock rule is enforced server-side, not just in the UI.
  if (data.locked) redirect("/dashboard/induction");

  // Self-hosted video is served through a short-lived signed URL.
  let videoSrc: string | null = null;
  if (data.lesson.videoKey && isS3Configured()) {
    try {
      videoSrc = await presignedGetUrl(data.lesson.videoKey, 3600);
    } catch {
      videoSrc = null;
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <Link
        href="/dashboard/induction"
        className="text-sm text-muted-foreground hover:underline inline-flex items-center gap-1"
      >
        <ArrowLeft className="size-4" /> Back to induction
      </Link>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">{data.lesson.title}</h1>
        {data.lesson.summary && (
          <p className="text-muted-foreground text-sm mt-1">{data.lesson.summary}</p>
        )}
      </div>

      <LessonPlayer
        lesson={{
          id: data.lesson.id,
          title: data.lesson.title,
          kind: data.lesson.kind,
          videoUrl: data.lesson.videoUrl,
          videoSrc,
          bodyMd: data.lesson.bodyMd,
          durationSeconds: data.lesson.durationSeconds,
        }}
        initial={{
          watchedSeconds: data.progress?.watchedSeconds ?? 0,
          completed: data.completed,
        }}
      />
    </div>
  );
}
