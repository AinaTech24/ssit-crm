import Link from "next/link";
import { ArrowRight, Target } from "lucide-react";
import { withTenant } from "@/db/client";
import type { SessionUser } from "@/lib/auth/session";
import { currentPeriod } from "@/lib/targets";
import { loadVisibleTargets } from "@/lib/targets/view";
import { TargetsTable } from "./TargetsTable";

/**
 * Dashboard panel: this month's target vs achievement, as a table in the same
 * style as "Meetings & portfolio reviews by RM".
 *
 * Who sees which rows is decided in loadVisibleTargets — the owner sees every
 * department, a team lead sees their team, and anyone else (an RA, an RIA, an
 * RM with no team) sees just their own row.
 *
 * It stays on screen even when there is nothing to show: a panel that vanishes
 * looks like a broken dashboard, and the empty state says what to do.
 */
export async function MyTargetsCard({ session }: { session: SessionUser }) {
  const period = currentPeriod();
  let cards;
  try {
    cards = await withTenant(
      session.tenantId,
      (tx) => loadVisibleTargets(tx, session, period),
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );
  } catch (err) {
    console.error("[my-targets-card] failed", err instanceof Error ? err.message : err);
    return null;
  }
  const isOwner = session.roles.includes("owner");
  const monthLabel = new Date(`${period}-01T00:00:00`).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  const people = cards.filter((c) => c.subjectType === "user").length;
  const team = isOwner || people > 1;

  return (
    <div className="mb-6 border rounded-lg bg-card">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-2.5 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="size-7 rounded-lg bg-violet-50 grid place-items-center">
            <Target className="size-3.5 text-violet-600" />
          </div>
          <div>
            <div className="font-medium text-sm">
              {team ? "Targets & achievement" : "My targets"} · {monthLabel}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {team
                ? "Target against what has been achieved this month, department by department"
                : "Your target against what you have achieved this month"}
            </div>
          </div>
        </div>
        <Link
          href="/dashboard/targets"
          className="text-xs text-violet-700 hover:underline font-medium inline-flex items-center gap-1"
        >
          {isOwner ? "Set targets" : "All targets"} <ArrowRight className="size-3.5" />
        </Link>
      </div>
      {cards.length === 0 ? (
        <p className="px-4 py-5 text-xs text-muted-foreground">
          {isOwner
            ? `No targets are set for ${monthLabel}. Set them on the Targets page and tick “show” for the people who should see theirs.`
            : `No targets have been shown to you for ${monthLabel}. Your admin sets them on the Targets page.`}
        </p>
      ) : (
        <TargetsTable cards={cards} you={session.userId} />
      )}
    </div>
  );
}
