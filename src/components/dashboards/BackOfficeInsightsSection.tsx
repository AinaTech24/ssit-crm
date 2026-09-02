import Link from "next/link";
import { sql } from "drizzle-orm";
import { Clock, ShieldCheck, FileCheck2, GitBranch, Gauge } from "lucide-react";
import { withTenant } from "@/db/client";
import { formatINR } from "@/lib/utils";
import type { SessionUser } from "@/lib/auth/session";

/**
 * Back office service-excellence additions — appended below the existing
 * BackOfficeDashboard so nothing is removed:
 *   1. Median time-in-stage on the onboarding funnel
 *   2. First-90-day playbook completion % (new investors with tasks closed)
 *   3. Risk-profile renewal queue
 *   4. Per-tile client-impact label (₹ value at stake)
 *   5. Auto vs manual SR resolution split
 */
export async function BackOfficeInsightsSection({ session }: { session: SessionUser }) {
  const data = await withTenant(
    session.tenantId,
    async (tx) => {
      const [
        timeInStage,
        ninetyDayPlaybook,
        riskProfileRenewal,
        autoVsManual,
        clientImpact,
      ] = await Promise.all([
        // 1. Median time-in-stage — last 90 days of stage exits
        await tx.execute(sql`
          SELECT stage_key,
            COUNT(*)::int AS exits,
            (PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY duration_seconds))::int AS median_seconds,
            COUNT(*) FILTER (WHERE breached_sla = true)::int AS breached
          FROM lead_stage_history
          WHERE exited_at >= now() - interval '90 days'
            AND duration_seconds IS NOT NULL
            AND duration_seconds > 0
          GROUP BY stage_key
          ORDER BY median_seconds DESC NULLS LAST
          LIMIT 8
        `),

        // 2. First-90-day playbook — new investors in last 90d with onboarding tasks
        await tx.execute(sql`
          WITH new_investors AS (
            SELECT id FROM investors
            WHERE onboarded_at >= now() - interval '90 days'
              AND status = 'active' AND deleted_at IS NULL
          ),
          investor_task_stats AS (
            SELECT
              ni.id AS investor_id,
              COUNT(t.id)::int AS total_tasks,
              COUNT(t.id) FILTER (WHERE t.status = 'completed')::int AS completed_tasks
            FROM new_investors ni
            LEFT JOIN tasks t
              ON (t.related_investor_id = ni.id OR (t.subject_type = 'investor' AND t.subject_id = ni.id))
              AND t.workflow_run_id IS NOT NULL
            GROUP BY ni.id
          )
          SELECT
            COUNT(*)::int AS new_count,
            COUNT(*) FILTER (WHERE total_tasks > 0 AND completed_tasks = total_tasks)::int AS fully_done,
            COUNT(*) FILTER (WHERE total_tasks > 0 AND completed_tasks > 0 AND completed_tasks < total_tasks)::int AS partial,
            COUNT(*) FILTER (WHERE total_tasks = 0 OR completed_tasks = 0)::int AS not_started,
            COALESCE(AVG(CASE WHEN total_tasks > 0 THEN 100.0 * completed_tasks / total_tasks ELSE NULL END), 0)::numeric AS avg_completion_pct
          FROM investor_task_stats
        `),

        // 3. Risk profile renewal — clients with risk profile signed >11 months ago
        await tx.execute(sql`
          SELECT
            COUNT(*) FILTER (WHERE risk_profile_signed_at IS NULL)::int AS never_done,
            COUNT(*) FILTER (
              WHERE risk_profile_signed_at IS NOT NULL
                AND risk_profile_signed_at < now() - interval '335 days'
                AND risk_profile_signed_at >= now() - interval '365 days'
            )::int AS due_30d,
            COUNT(*) FILTER (
              WHERE risk_profile_signed_at < now() - interval '365 days'
            )::int AS overdue
          FROM investors WHERE status = 'active' AND deleted_at IS NULL
        `),

        // 4. Auto vs manual SR resolution (last 90 days)
        await tx.execute(sql`
          SELECT
            COUNT(*) FILTER (
              WHERE EXISTS (
                SELECT 1 FROM communications c
                WHERE c.investor_id = sr.investor_id
                  AND c.workflow_run_id IS NOT NULL
                  AND c.created_at BETWEEN sr.created_at AND sr.resolved_at
              )
            )::int AS auto_assisted,
            COUNT(*) FILTER (WHERE sr.resolved_at IS NOT NULL)::int AS total_resolved
          FROM service_requests sr
          WHERE sr.resolved_at >= now() - interval '90 days'
        `),

        // 5. Client impact (₹) per queue
        await tx.execute(sql`
          SELECT
            (SELECT COALESCE(SUM(i.aum::numeric), 0)::numeric
              FROM investors i WHERE i.kyc_status IN ('pending', 'expired') AND i.deleted_at IS NULL) AS kyc_aum_at_stake,
            (SELECT COALESCE(SUM(s.amount::numeric), 0)::numeric
              FROM sips s WHERE s.status = 'pending') AS sip_pending_value,
            (SELECT COALESCE(SUM(i.aum::numeric), 0)::numeric
              FROM investors i WHERE (i.nominee_name IS NULL OR i.nominee_name = '') AND i.deleted_at IS NULL) AS nominee_aum_at_stake
        `),
      ]);

      const np = ninetyDayPlaybook.rows[0] as any;
      const rp = riskProfileRenewal.rows[0] as any;
      const am = autoVsManual.rows[0] as any;
      const ci = clientImpact.rows[0] as any;

      return {
        timeInStage: (timeInStage.rows as any[]).map((r) => ({
          stage: String(r.stage_key),
          medianHours: Math.round(Number(r.median_seconds) / 3600),
          exits: Number(r.exits),
          breached: Number(r.breached),
        })),
        playbook: {
          newCount: Number(np.new_count),
          fullyDone: Number(np.fully_done),
          partial: Number(np.partial),
          notStarted: Number(np.not_started),
          avgPct: Number(np.avg_completion_pct),
        },
        riskProfile: {
          neverDone: Number(rp.never_done),
          due30d: Number(rp.due_30d),
          overdue: Number(rp.overdue),
        },
        autoVsManual: {
          autoAssisted: Number(am.auto_assisted),
          totalResolved: Number(am.total_resolved),
        },
        clientImpact: {
          kycAum: Number(ci.kyc_aum_at_stake),
          sipPendingValue: Number(ci.sip_pending_value),
          nomineeAum: Number(ci.nominee_aum_at_stake),
        },
      };
    },
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );

  const autoPct =
    data.autoVsManual.totalResolved > 0
      ? (data.autoVsManual.autoAssisted / data.autoVsManual.totalResolved) * 100
      : 0;

  return (
    <div className="space-y-6">
      {/* Client impact strip */}
      <div className="card-surface glass-card p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold flex items-center gap-2 text-sm tracking-tight text-foreground/90">
            <div className="size-7 rounded-lg bg-rose-50 grid place-items-center">
              <Gauge className="size-3.5 text-rose-600" />
            </div>
            ₹ at stake in the queues
          </h2>
          <span className="text-xs text-muted-foreground">
            Translate counts into client impact
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <ImpactCard
            label="KYC pending"
            value={formatINR(data.clientImpact.kycAum)}
            sub="AUM blocked from new flows"
            tone="rose"
          />
          <ImpactCard
            label="SIP registrations pending"
            value={formatINR(data.clientImpact.sipPendingValue)}
            sub="monthly inflow blocked"
            tone="amber"
          />
          <ImpactCard
            label="Nominee missing"
            value={formatINR(data.clientImpact.nomineeAum)}
            sub="transmission risk exposure"
            tone="rose"
          />
        </div>
      </div>

      {/* Time-in-stage + Auto-resolution */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2 card-surface glass-card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold flex items-center gap-2 text-sm tracking-tight text-foreground/90">
              <div className="size-7 rounded-lg bg-brand-cyan-light grid place-items-center">
                <Clock className="size-3.5 text-brand-cyan-deep" />
              </div>
              Median time-in-stage (90d)
            </h2>
            <span className="text-xs text-muted-foreground">Where the funnel stalls</span>
          </div>
          {data.timeInStage.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No completed stage transitions in last 90 days.
            </p>
          ) : (
            <ul className="space-y-2.5">
              {data.timeInStage.map((s) => {
                const days = s.medianHours / 24;
                const tone = days > 5 ? "rose" : days > 2 ? "amber" : "emerald";
                const bg =
                  tone === "rose"
                    ? "bg-rose-500"
                    : tone === "amber"
                    ? "bg-amber-500"
                    : "bg-emerald-500";
                const text =
                  tone === "rose"
                    ? "text-rose-700"
                    : tone === "amber"
                    ? "text-amber-700"
                    : "text-emerald-700";
                const widthPct = Math.min(100, (days / 10) * 100);
                return (
                  <div key={s.stage}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="font-medium capitalize">
                        {s.stage.replace(/_/g, " ")}
                      </span>
                      <span className="text-muted-foreground tabular-nums">
                        median{" "}
                        <span className={`font-bold ${text}`}>
                          {days.toFixed(1)}d
                        </span>{" "}
                        · {s.exits} exits · {s.breached} breached
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                      <div
                        className={`h-full rounded-full ${bg}`}
                        style={{ width: `${widthPct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </ul>
          )}
        </div>

        <div className="card-surface glass-card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold flex items-center gap-2 text-sm tracking-tight text-foreground/90">
              <div className="size-7 rounded-lg bg-emerald-50 grid place-items-center">
                <GitBranch className="size-3.5 text-emerald-600" />
              </div>
              SR resolution mix (90d)
            </h2>
          </div>
          <div className="space-y-3">
            <div className="bg-emerald-50/50 border border-emerald-100 rounded-lg p-3">
              <div className="text-[10px] uppercase tracking-wider text-emerald-800 font-semibold">
                Workflow-assisted
              </div>
              <div className="text-2xl font-bold text-emerald-800 mt-1 tabular-nums">
                {autoPct.toFixed(0)}%
              </div>
              <div className="text-[11px] text-emerald-800/80 mt-0.5">
                {data.autoVsManual.autoAssisted} of{" "}
                {data.autoVsManual.totalResolved} resolved tickets had
                automated comms
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              Counts tickets where a workflow-triggered comm went out during
              the open window — a proxy for "we acted before the customer
              had to chase".
            </p>
          </div>
        </div>
      </div>

      {/* First-90-day playbook + Risk profile renewal */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card-surface glass-card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold flex items-center gap-2 text-sm tracking-tight text-foreground/90">
              <div className="size-7 rounded-lg bg-brand-cyan-light grid place-items-center">
                <FileCheck2 className="size-3.5 text-brand-cyan-deep" />
              </div>
              First-90-day playbook
            </h2>
            <span className="text-xs text-muted-foreground">
              {data.playbook.newCount} new clients
            </span>
          </div>
          <div className="bg-brand-cyan-light/40 rounded-lg p-3 mb-3">
            <div className="text-[10px] uppercase tracking-wider text-brand-cyan-deep font-semibold">
              Avg checklist completion
            </div>
            <div className="text-2xl font-bold text-brand-cyan-deep mt-1 tabular-nums">
              {data.playbook.avgPct.toFixed(0)}%
            </div>
          </div>
          <div className="space-y-2 text-xs">
            <Row label="All steps done" value={data.playbook.fullyDone} tone="emerald" />
            <Row label="Partially done" value={data.playbook.partial} tone="amber" />
            <Row label="Not started" value={data.playbook.notStarted} tone="rose" />
          </div>
        </div>

        <div className="card-surface glass-card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold flex items-center gap-2 text-sm tracking-tight text-foreground/90">
              <div className="size-7 rounded-lg bg-amber-50 grid place-items-center">
                <ShieldCheck className="size-3.5 text-amber-700" />
              </div>
              Risk profile renewal queue
            </h2>
            <Link
              href="/dashboard/risk-profiles"
              className="text-xs text-amber-700 hover:underline font-semibold"
            >
              Open →
            </Link>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <RpTile
              label="Never done"
              value={data.riskProfile.neverDone}
              tone="rose"
            />
            <RpTile
              label="Due in 30d"
              value={data.riskProfile.due30d}
              tone="amber"
            />
            <RpTile
              label="Overdue (>1y)"
              value={data.riskProfile.overdue}
              tone="rose"
            />
          </div>
          <p className="text-[10px] text-muted-foreground mt-3 leading-relaxed">
            SEBI mandates periodic risk-profile refresh. An expired profile
            invalidates advisory and can stop new investments.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ----------------------- presentational helpers ----------------------- */

function ImpactCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone: "rose" | "amber";
}) {
  const cls =
    tone === "rose"
      ? "border-rose-100 bg-rose-50/40 text-rose-700"
      : "border-amber-100 bg-amber-50/40 text-amber-700";
  return (
    <div className={`p-3 rounded-lg border ${cls}`}>
      <div className="text-[10px] uppercase tracking-wider font-semibold opacity-80">
        {label}
      </div>
      <div className="text-xl font-bold mt-1 tabular-nums">{value}</div>
      <div className="text-[10px] mt-0.5 opacity-80">{sub}</div>
    </div>
  );
}

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "rose" | "amber" | "emerald";
}) {
  const cls =
    tone === "rose"
      ? "text-rose-700"
      : tone === "amber"
      ? "text-amber-700"
      : "text-emerald-700";
  return (
    <div className="flex items-center justify-between py-1 border-b last:border-0 border-border/40">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-bold tabular-nums ${cls}`}>{value}</span>
    </div>
  );
}

function RpTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "rose" | "amber";
}) {
  const cls =
    tone === "rose"
      ? "border-rose-100 bg-rose-50/40 text-rose-700"
      : "border-amber-100 bg-amber-50/40 text-amber-700";
  return (
    <div className={`p-2.5 rounded-lg border ${cls}`}>
      <div className="text-[10px] uppercase tracking-wider font-semibold opacity-80">
        {label}
      </div>
      <div className="text-xl font-bold mt-1 tabular-nums">{value}</div>
    </div>
  );
}
