import Link from "next/link";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { Target, Plus } from "lucide-react";
import { withTenant } from "@/db/client";
import { goals, investors } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { requireAny, can } from "@/lib/auth/rbac";
import { CompactFilterBar } from "@/components/common/CompactFilterBar";
import { CustomViews } from "@/components/common/CustomViews";
import { GoalsBulkTable } from "@/components/goals/GoalsBulkTable";
import { Pager } from "@/components/common/Pager";

export const dynamic = "force-dynamic";

export default async function GoalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  // Client financial goals — require an investor-view capability and scope
  // non-managers to their own clients (the page previously showed every client's
  // goals to any role).
  requireAny(session.roles, ["investor.view.all", "investor.view.assigned"], session.permissions);
  const canViewAll = can(session.roles, "investor.view.all", session.permissions);
  const sp = await searchParams;
  const PAGE_SIZE = 50;
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  // Sort the list — by target date or target amount, ascending or descending.
  const sortKey = (["target_date_asc", "target_date_desc", "target_amount_desc", "target_amount_asc"] as const).includes(
    (sp.sort ?? "") as any
  )
    ? (sp.sort as "target_date_asc" | "target_date_desc" | "target_amount_desc" | "target_amount_asc")
    : "target_date_asc";
  const orderBy =
    sortKey === "target_date_desc" ? desc(goals.targetDate)
      : sortKey === "target_amount_desc" ? desc(goals.targetAmount)
        : sortKey === "target_amount_asc" ? asc(goals.targetAmount)
          : asc(goals.targetDate);

  const { rows, stats } = await withTenant(session.tenantId, async (tx) => {
    // Owner slice for non-managers — only goals whose client is assigned to them.
    // Exclude goals whose client is soft-deleted (consistent with the list below).
    const statsScope = canViewAll
      ? sql` WHERE (investor_id IS NULL OR investor_id IN (SELECT id FROM investors WHERE deleted_at IS NULL))`
      : sql` WHERE investor_id IN (SELECT id FROM investors WHERE rm_id = ${session.userId}::uuid AND deleted_at IS NULL)`;
    // KPIs from a single aggregate over ALL goals — not the paginated slice
    // (the old code derived counts from a LIMIT 200 page, so they capped/lied
    // once a firm had more than 200 goals).
    const s = (
      await tx.execute(sql`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'on_track')::int AS on_track,
          COUNT(*) FILTER (WHERE status = 'behind_track')::int AS behind,
          COUNT(*) FILTER (WHERE status = 'achieved')::int AS achieved,
          COUNT(*) FILTER (WHERE status = 'not_started')::int AS not_started,
          COUNT(*) FILTER (WHERE next_review_at IS NOT NULL AND next_review_at < now() AND status NOT IN ('achieved','abandoned'))::int AS reviews_overdue
        FROM goals${statsScope}
      `)
    ).rows[0] as any;

    const r = await tx
      .select({ goal: goals, investorName: investors.name, investorAvatarUrl: investors.avatarUrl })
      .from(goals)
      .leftJoin(investors, eq(investors.id, goals.investorId))
      // Exclude goals whose client has been soft-deleted (they live in Trash) —
      // they were showing here with links that 404'd on the deleted client.
      .where(and(isNull(investors.deletedAt), canViewAll ? undefined : eq(investors.rmId, session.userId)))
      .orderBy(orderBy)
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE);

    return {
      // Flatten for BulkTable (needs a top-level `id`).
      rows: r.map(({ goal, investorName, investorAvatarUrl }) => ({ ...goal, investorName, investorAvatarUrl })),
      stats: {
        total: Number(s.total),
        onTrack: Number(s.on_track),
        behind: Number(s.behind),
        achieved: Number(s.achieved),
        notStarted: Number(s.not_started),
        reviewsOverdue: Number(s.reviews_overdue),
      },
    };
  });

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Target className="size-6 text-brand-cyan" /> Goal planning
          </h1>
        </div>
        <Link href="/dashboard/goals/new" className="btn-primary">
          <Plus className="size-4" /> Add Goal
        </Link>
      </div>

      <CompactFilterBar
        totalCount={stats.total}
        rightSlot={<CustomViews viewsKey="views:goals" />}
        filters={[
          {
            type: "sort",
            key: "sort",
            label: "Sort",
            options: [
              { value: "target_date_asc", label: "Target date — soonest" },
              { value: "target_date_desc", label: "Target date — latest" },
              { value: "target_amount_desc", label: "Target ₹ — high to low" },
              { value: "target_amount_asc", label: "Target ₹ — low to high" },
            ],
          },
        ]}
      />

      <div className="card-surface">
        {rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            <Target className="size-8 mx-auto text-muted-foreground/50" />
            <div className="mt-2 font-medium">No goals tracked yet.</div>
            <p className="mt-2 text-xs max-w-md mx-auto">
              Click <strong>Add Goal</strong> above to start. The wizard computes required SIP and
              gap analysis live as you type.
            </p>
          </div>
        ) : (
          <GoalsBulkTable rows={rows} />
        )}
        {rows.length > 0 && (
          <div className="px-4 pb-3">
            <Pager
              page={page}
              totalPages={Math.ceil(stats.total / PAGE_SIZE)}
              total={stats.total}
              pageSize={PAGE_SIZE}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "emerald" | "rose" | "amber" | "muted";
}) {
  const color =
    tone === "emerald"
      ? "text-emerald-600"
      : tone === "rose"
        ? "text-rose-600"
        : tone === "amber"
          ? "text-amber-600"
          : "text-foreground";
  return (
    <div className="card-surface p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-bold mt-1 tabular-nums ${color}`}>{value}</div>
    </div>
  );
}
