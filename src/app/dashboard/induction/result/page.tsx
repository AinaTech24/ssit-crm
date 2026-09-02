import Link from "next/link";
import { redirect } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { ArrowLeft, CheckCircle2, FileText } from "lucide-react";
import { withTenant } from "@/db/client";
import { inductionAttempts, inductionEnrolments, inductionTracks } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function InductionResultPage() {
  const session = await requireSession();

  const data = await withTenant(session.tenantId, async (tx) => {
    const [enrolment] = await tx
      .select()
      .from(inductionEnrolments)
      .where(eq(inductionEnrolments.userId, session.userId))
      .limit(1);
    if (!enrolment || enrolment.status !== "passed") return null;

    const [track] = await tx
      .select()
      .from(inductionTracks)
      .where(eq(inductionTracks.id, enrolment.trackId))
      .limit(1);
    const [pass] = await tx
      .select()
      .from(inductionAttempts)
      .where(and(eq(inductionAttempts.enrolmentId, enrolment.id), eq(inductionAttempts.passed, true)))
      .orderBy(desc(inductionAttempts.attemptNo))
      .limit(1);

    return { enrolment, track, scorePct: Number(pass?.scorePct ?? 0) };
  });

  if (!data) redirect("/dashboard/induction");

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <Link
        href="/dashboard/induction"
        className="text-sm text-muted-foreground hover:underline inline-flex items-center gap-1"
      >
        <ArrowLeft className="size-4" /> Back to induction
      </Link>

      <div className="card-surface p-8 text-center">
        <div className="mx-auto size-14 rounded-full bg-emerald-100 text-emerald-600 grid place-items-center mb-3">
          <CheckCircle2 className="size-7" />
        </div>
        <div className="text-lg font-bold">Induction complete</div>
        <p className="text-sm text-muted-foreground mt-1">{data.track?.name}</p>
        <div className="text-3xl font-bold tabular-nums mt-3">{data.scorePct}%</div>
        {data.enrolment.completedAt && (
          <p className="text-xs text-muted-foreground mt-1">
            Passed on{" "}
            {new Date(data.enrolment.completedAt).toLocaleDateString("en-IN", {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </p>
        )}

        {data.enrolment.letterToken ? (
          <a
            href={`/induction/letter/${data.enrolment.letterToken}`}
            target="_blank"
            rel="noreferrer"
            className="btn-primary mt-5 inline-flex"
          >
            <FileText className="size-4" /> Open confirmation letter
          </a>
        ) : (
          <p className="text-xs text-muted-foreground mt-5">
            No confirmation letter is issued for this track.
          </p>
        )}
      </div>
    </div>
  );
}
