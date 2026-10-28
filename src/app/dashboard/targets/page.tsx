import { Target } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { currentPeriod, validPeriod } from "@/lib/targets";
import { loadVisibleTargets } from "@/lib/targets/view";
import { TargetProgress } from "@/components/targets/TargetProgress";
import { TargetsManager } from "@/components/targets/TargetsManager";

export const dynamic = "force-dynamic";

/**
 * Targets & achievements. The admin sets the month's targets for people,
 * branches and desks and chooses who is shown theirs; everyone else sees the
 * targets shown to them against what they have achieved.
 */
export default async function TargetsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  const period = validPeriod(sp.period) ? sp.period : currentPeriod();
  const isOwner = session.roles.includes("owner");
  const cards = await withTenant(
    session.tenantId,
    (tx) => loadVisibleTargets(tx, session, period),
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );
  const label = new Date(`${period}-01T00:00:00`).toLocaleDateString("en-IN", { month: "long", year: "numeric" });

  return (
    <div className="space-y-5 max-w-7xl">
      <h1 className="page-title">
        <Target className="size-6 text-brand-cyan" /> Targets &amp; achievement
      </h1>

      {isOwner && <TargetsManager initialPeriod={period} />}

      <div>
        <h2 className="mb-2 text-sm font-semibold">
          {isOwner ? `Achievement · ${label}` : `Your targets · ${label}`}
        </h2>
        {cards.length === 0 ? (
          <div className="card-surface p-8 text-center text-sm text-muted-foreground">
            {isOwner
              ? "No targets set for this month yet. Fill in the grid above and save."
              : "No targets have been shown to you for this month."}
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {cards.map((c) => (
              <TargetProgress key={`${c.subjectType}:${c.subjectId}`} card={c} you={c.subjectType === "user" && c.subjectId === session.userId} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
