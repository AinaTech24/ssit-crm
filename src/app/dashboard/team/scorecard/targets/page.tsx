/**
 * KRA targets editor — set each person's annual target per metric. The scorecard
 * pro-rates these to the selected period for actual-vs-target scoring. Owners /
 * branch heads only.
 */

import Link from "next/link";
import { sql } from "drizzle-orm";
import { Target, ArrowLeft } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { withTenant } from "@/db/client";
import { currentFiscalYear } from "@/lib/business/sif-status";
import { TARGETABLE_METRICS } from "@/lib/team/scorecard";
import { TargetGrid } from "@/components/team/TargetGrid";

export const dynamic = "force-dynamic";

export default async function TargetsPage() {
  const session = await requireSession();
  if (!can(session.roles, "dashboard.view.owner", session.permissions)) {
    return (
      <div className="card-surface p-12 text-center max-w-lg mx-auto">
        <Target className="size-10 text-amber-500 mx-auto mb-3" />
        <div className="font-semibold text-lg">Managers only</div>
        <p className="text-sm text-muted-foreground mt-1">Setting KRA targets is for owners and branch heads.</p>
      </div>
    );
  }
  const fy = currentFiscalYear();

  const { sales, ops, targets } = await withTenant(session.tenantId, async (tx) => {
    const roster = async (predicate: any) =>
      ((await tx.execute(sql`SELECT id, name FROM users WHERE tenant_id = ${session.tenantId}::uuid AND status='active' AND ${predicate} ORDER BY name ASC`)).rows as any[]).map(
        (u) => ({ id: String(u.id), name: u.name ?? "—" })
      );
    const sales = await roster(sql`('rm' = ANY(roles) OR 'branch_head' = ANY(roles))`);
    const ops = await roster(sql`('ops' = ANY(roles) OR 'back_office' = ANY(roles))`);
    const tr = await tx.execute(
      sql`SELECT user_id, metric_key, annual_target FROM kra_targets WHERE tenant_id = ${session.tenantId}::uuid AND fiscal_year = ${fy}`
    );
    const targets: Record<string, number> = {};
    for (const row of tr.rows as any[]) targets[`${String(row.user_id)}:${row.metric_key}`] = Number(row.annual_target) || 0;
    return { sales, ops, targets };
  });

  const salesMetrics = TARGETABLE_METRICS.filter((m) => m.team === "sales");
  const opsMetrics = TARGETABLE_METRICS.filter((m) => m.team === "ops");

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <Link href="/dashboard/team/scorecard" className="text-xs text-muted-foreground hover:underline inline-flex items-center gap-1 mb-1">
          <ArrowLeft className="size-3" /> Scorecard
        </Link>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Target className="size-6 text-brand-cyan" /> KRA targets
        </h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          Annual targets for FY {fy}. The scorecard pro-rates each to the selected period (e.g. month-to-date) and
          scores actual vs target. Leave blank to keep that KPI on relative (leaderboard) scoring.
        </p>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-bold uppercase tracking-wide">Sales team</h2>
        <TargetGrid members={sales} metrics={salesMetrics} initial={targets} fiscalYear={fy} />
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-bold uppercase tracking-wide">Operations team</h2>
        <TargetGrid members={ops} metrics={opsMetrics} initial={targets} fiscalYear={fy} />
      </section>
    </div>
  );
}
