/**
 * Create-goal page — picks an investor + collects target amount/year + computes
 * Required SIP / Gap live as the user types.
 *
 *   /dashboard/goals/new                    → investor picker
 *   /dashboard/goals/new?investorId=<id>    → form
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { ChevronLeft, Target } from "lucide-react";
import { withTenant } from "@/db/client";
import { investors } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { GoalCreateForm } from "@/components/goal-planning/GoalCreateForm";

export const dynamic = "force-dynamic";

export default async function NewGoalPage({
  searchParams,
}: {
  searchParams: Promise<{ investorId?: string }>;
}) {
  const sp = await searchParams;
  const session = await requireSession();

  if (!sp.investorId) {
    const list = await withTenant(session.tenantId, async (tx) => {
      const r = await tx.execute(sql`
        SELECT id, name, pan, segment_tag,
          (SELECT COUNT(*)::int FROM goals WHERE investor_id = investors.id) AS goal_count
        FROM investors WHERE status = 'active' AND deleted_at IS NULL
        ORDER BY name LIMIT 200
      `);
      return r.rows as any[];
    });

    return (
      <div className="max-w-3xl mx-auto space-y-4">
        <Link
          href="/dashboard/goals"
          className="text-sm text-muted-foreground hover:underline flex items-center gap-1"
        >
          <ChevronLeft className="size-4" /> Back to goals
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Add a goal</h1>
        </div>
        {/* Limited-height, scrollable picker (hidden scrollbar) so a long book
            doesn't stretch the page. */}
        <div className="card-surface overflow-hidden">
          <ul className="divide-y max-h-[60vh] overflow-y-auto scrollbar-none">
            {list.map((i) => (
              <li key={i.id}>
                <Link
                  href={`/dashboard/goals/new?investorId=${i.id}`}
                  className="block px-4 py-3 hover:bg-secondary/60 flex items-center justify-between"
                >
                  <div>
                    <div className="font-medium">{i.name}</div>
                    <div className="text-xs text-muted-foreground font-mono">{i.pan}</div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {i.segment_tag ?? "—"} · {i.goal_count} goal{i.goal_count === 1 ? "" : "s"}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  const inv = await withTenant(session.tenantId, async (tx) =>
    (await tx.select().from(investors).where(eq(investors.id, sp.investorId!)).limit(1))[0] ?? null
  );
  if (!inv) notFound();

  return (
    <div className="max-w-7xl mx-auto space-y-4">
      <Link
        href="/dashboard/goals"
        className="text-sm text-muted-foreground hover:underline flex items-center gap-1"
      >
        <ChevronLeft className="size-4" /> Back to goals
      </Link>
      <div className="card-elevated overflow-hidden">
        <div className="brand-mesh px-6 py-5 text-white flex items-center gap-4">
          <div className="size-12 rounded-xl bg-white/15 backdrop-blur-sm grid place-items-center ring-2 ring-white/20">
            <Target className="size-6 text-white" />
          </div>
          <div className="flex-1">
            <div className="text-[11px] uppercase tracking-[0.18em] text-white/70 font-semibold">
              New financial goal
            </div>
            <h1 className="text-2xl font-bold tracking-tight mt-0.5">{inv.name}</h1>
            <div className="text-white/80 text-sm mt-0.5">
              PAN <span className="font-mono">{inv.pan}</span>
              {inv.segmentTag && (
                <>
                  <span className="mx-2 text-white/40">·</span>
                  <span>{inv.segmentTag}</span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
      <GoalCreateForm investorId={inv.id} investorName={inv.name} />
    </div>
  );
}
