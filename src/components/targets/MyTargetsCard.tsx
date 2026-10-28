import Link from "next/link";
import { Target } from "lucide-react";
import { withTenant } from "@/db/client";
import type { SessionUser } from "@/lib/auth/session";
import { currentPeriod } from "@/lib/targets";
import { loadVisibleTargets } from "@/lib/targets/view";
import { TargetProgress } from "./TargetProgress";

/**
 * Dashboard strip: this month's target vs achievement for the viewer. Renders
 * nothing until the admin has set (and shown) a target for them, their branch or
 * their desk — an empty "no targets" box would be noise on every dashboard.
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
  // The dashboard strip is the viewer's own and their branch / desk — the full
  // team list lives on the Targets page.
  const mine = cards.filter((c) => c.subjectType !== "user" || c.subjectId === session.userId);
  if (mine.length === 0) return null;
  return (
    <div className="mb-6">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Target className="size-4 text-brand-cyan" /> Targets &amp; achievement ·{" "}
          {new Date(`${period}-01T00:00:00`).toLocaleDateString("en-IN", { month: "long", year: "numeric" })}
        </div>
        <Link href="/dashboard/targets" className="text-xs text-muted-foreground hover:underline">
          All targets
        </Link>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {mine.map((c) => (
          <TargetProgress key={`${c.subjectType}:${c.subjectId}`} card={c} you={c.subjectType === "user"} />
        ))}
      </div>
    </div>
  );
}
