/**
 * My Induction — the member's track: ordered lessons, progress, lock state.
 *
 * A lesson unlocks once every previous REQUIRED lesson is complete, so the
 * track is walked in order.
 */

import Link from "next/link";
import { eq } from "drizzle-orm";
import { CheckCircle2, GraduationCap, Lock, PlayCircle, FileText, ExternalLink } from "lucide-react";
import { withTenant } from "@/db/client";
import { inductionEnrolments, inductionTracks } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { loadTrackState } from "@/lib/induction/engine";

export const dynamic = "force-dynamic";

const KIND_ICON: Record<string, any> = {
  video: PlayCircle,
  document: FileText,
  kb_article: FileText,
  link: ExternalLink,
  checklist: CheckCircle2,
};

export default async function InductionPage() {
  const session = await requireSession();

  const data = await withTenant(session.tenantId, async (tx) => {
    const [enrolment] = await tx
      .select()
      .from(inductionEnrolments)
      .where(eq(inductionEnrolments.userId, session.userId))
      .limit(1);
    if (!enrolment) return null;

    const [track] = await tx
      .select()
      .from(inductionTracks)
      .where(eq(inductionTracks.id, enrolment.trackId))
      .limit(1);
    if (!track) return null;

    const state = await loadTrackState(tx, enrolment.id, enrolment.trackId);
    return { enrolment, track, state };
  });

  if (!data) {
    return (
      <div className="max-w-3xl mx-auto">
        <div className="card-surface p-12 text-center">
          <div className="mx-auto size-12 rounded-full bg-brand-cyan-light/40 flex items-center justify-center mb-3">
            <GraduationCap className="size-6 text-brand-cyan" />
          </div>
          <div className="text-sm font-semibold text-slate-700">No induction assigned</div>
          <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
            You haven't been enrolled on a training track. If you've just joined, ask your manager to
            assign one.
          </p>
        </div>
      </div>
    );
  }

  const { track, state, enrolment } = data;
  const passed = enrolment.status === "passed";

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div className="rounded-2xl border border-border bg-gradient-to-br from-brand-cyan-light/50 via-card to-card p-5 sm:p-6">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <span className="grid place-items-center size-9 rounded-xl bg-brand-cyan text-white shadow-sm">
            <GraduationCap className="size-5" />
          </span>
          {track.name}
        </h1>
        {track.description && (
          <p className="text-muted-foreground text-sm mt-2">{track.description}</p>
        )}

        <div className="mt-5">
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="text-muted-foreground">
              {state.requiredDone} of {state.requiredTotal} steps complete
            </span>
            <span className="font-semibold tabular-nums">{state.percent}%</span>
          </div>
          <div className="h-2 rounded-full bg-secondary overflow-hidden">
            <div
              className="h-full bg-brand-cyan transition-all"
              style={{ width: `${state.percent}%` }}
            />
          </div>
        </div>
      </div>

      <ul className="card-surface divide-y overflow-hidden">
        {state.lessons.map((s: any, i: number) => {
          const Icon = KIND_ICON[s.lesson.kind] ?? PlayCircle;
          const body = (
            <div className="px-4 py-3 flex items-center gap-3">
              <span
                className={`shrink-0 grid place-items-center size-8 rounded-full text-xs font-semibold ${
                  s.completed
                    ? "bg-emerald-500 text-white"
                    : s.locked
                      ? "bg-slate-100 text-slate-400"
                      : "bg-brand-cyan-light/60 text-brand-cyan-deep"
                }`}
              >
                {s.completed ? <CheckCircle2 className="size-4" /> : s.locked ? <Lock className="size-3.5" /> : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className={`text-sm font-medium truncate ${s.locked ? "text-slate-400" : ""}`}>
                  {s.lesson.title}
                </div>
                {s.lesson.summary && (
                  <div className="text-xs text-muted-foreground truncate mt-0.5">{s.lesson.summary}</div>
                )}
              </div>
              <Icon className={`size-4 shrink-0 ${s.locked ? "text-slate-300" : "text-muted-foreground"}`} />
            </div>
          );

          return (
            <li key={s.lesson.id} className={s.locked ? "opacity-70" : "hover:bg-slate-50/70"}>
              {s.locked ? (
                <div title="Complete the previous step first">{body}</div>
              ) : (
                <Link href={`/dashboard/induction/${s.lesson.id}`}>{body}</Link>
              )}
            </li>
          );
        })}
        {state.lessons.length === 0 && (
          <li className="p-8 text-center text-sm text-muted-foreground">
            This track has no lessons yet.
          </li>
        )}
      </ul>

      {/* Exam gate */}
      <div className="card-surface p-5 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm font-semibold">Final assessment</div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {passed
              ? "You've passed. Your confirmation letter is ready."
              : state.allRequiredDone
                ? `Pass mark ${track.passMark}%.`
                : "Unlocks when every step above is complete."}
          </p>
        </div>
        {passed ? (
          <Link href="/dashboard/induction/result" className="btn-primary shrink-0">
            View result
          </Link>
        ) : (
          <Link
            href="/dashboard/induction/exam"
            aria-disabled={!state.allRequiredDone}
            className={`btn-primary shrink-0 ${
              state.allRequiredDone ? "" : "pointer-events-none opacity-40"
            }`}
          >
            Start exam
          </Link>
        )}
      </div>
    </div>
  );
}
