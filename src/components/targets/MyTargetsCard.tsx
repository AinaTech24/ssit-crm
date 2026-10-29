import Link from "next/link";
import { Target } from "lucide-react";
import { withTenant } from "@/db/client";
import type { SessionUser } from "@/lib/auth/session";
import { currentPeriod } from "@/lib/targets";
import { loadVisibleTargets } from "@/lib/targets/view";
import { TargetsTable } from "./TargetsTable";
import { TargetsList } from "./TargetsList";

/**
 * Dashboard strip: this month's target vs achievement. Renders nothing until the
 * admin has set (and shown) a target — an empty "no targets" box would be noise
 * on every dashboard.
 *
 * Owner and branch head see the team as a table, RM by RM. Everyone else sees
 * their own targets (and their branch / desk) as a short list, in the style of
 * "My open tasks".
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
  const isManager = session.roles.includes("owner") || session.roles.includes("branch_head");
  const shown = isManager ? cards : cards.filter((c) => c.subjectType !== "user" || c.subjectId === session.userId);
  if (shown.length === 0) return null;
  return (
    <div className="mb-6 rounded-xl border bg-card">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Target className="size-4 text-brand-cyan" />
          {isManager ? "Targets & achievement" : "My targets"} ·{" "}
          {new Date(`${period}-01T00:00:00`).toLocaleDateString("en-IN", { month: "long", year: "numeric" })}
        </div>
        <Link href="/dashboard/targets" className="text-xs text-muted-foreground hover:underline">
          All targets
        </Link>
      </div>
      {isManager ? (
        <TargetsTable cards={shown} />
      ) : (
        <div className="px-4">
          <TargetsList cards={shown} userId={session.userId} />
        </div>
      )}
    </div>
  );
}
