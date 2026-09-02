import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { withTenant } from "@/db/client";
import { inductionEnrolments } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { loadTrackState } from "@/lib/induction/engine";
import { ExamRunner } from "@/components/induction/ExamRunner";

export const dynamic = "force-dynamic";

export default async function InductionExamPage() {
  const session = await requireSession();

  const gate = await withTenant(session.tenantId, async (tx) => {
    const [enrolment] = await tx
      .select()
      .from(inductionEnrolments)
      .where(eq(inductionEnrolments.userId, session.userId))
      .limit(1);
    if (!enrolment) return { ok: false as const };
    if (enrolment.status === "passed") return { ok: false as const, passed: true };
    const state = await loadTrackState(tx, enrolment.id, enrolment.trackId);
    return { ok: state.allRequiredDone };
  });

  // Server-side gate — the exam can't be reached by URL before the lessons are done.
  if (!gate.ok) redirect("/dashboard/induction");

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <Link
        href="/dashboard/induction"
        className="text-sm text-muted-foreground hover:underline inline-flex items-center gap-1"
      >
        <ArrowLeft className="size-4" /> Back to induction
      </Link>
      <h1 className="text-2xl font-bold tracking-tight">Final assessment</h1>
      <ExamRunner />
    </div>
  );
}
