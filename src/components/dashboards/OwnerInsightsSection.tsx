import Link from "next/link";
import { sql } from "drizzle-orm";
import {
  Bot,
  ShieldCheck,
  AlertTriangle,
  TrendingDown,
  Building2,
  Briefcase,
  UserX,
  CalendarCheck,
  Activity,
  ArrowRight,
  Sparkles,
} from "lucide-react";
import { withTenant } from "@/db/client";
import { formatINR } from "@/lib/utils";
import type { SessionUser } from "@/lib/auth/session";

/**
 * Owner Insights — second-level section appended to OwnerCockpit.
 *
 * Bundles all queries in a single Promise.all so the page render only pays
 * one transaction setup cost. Renders multiple cards:
 *   1. Automation ROI strip (4 stats)
 *   2. Service Promise Adherence + Client Health bands
 *   3. Compliance Waterfall (30/60/90 day expiry funnel)
 *   4. Recovery list + Lost AUM watch (side-by-side)
 *   5. AMC concentration + Forward SIP projection (side-by-side)
 *   6. Inactive-RM detector + Review cadence (side-by-side)
 */
export async function OwnerInsightsSection({ session }: { session: SessionUser }) {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const last30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const last60 = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
  const last90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const last180 = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();
  const last365 = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();

  const data = await withTenant(
    session.tenantId,
    async (tx) => {
      const [
        automation,
        serviceAdherence,
        healthBands,
        compliance,
        recovery,
        lostAum,
        amcConcentration,
        sipProjection,
        rmActivity,
        reviewCadence,
        // Sequential: these share one tx connection — `[await …, await …]`
        // evaluates left-to-right, so pg never runs two queries at once (which
        // it can't, and which emits a deprecation that pg@9 turns into an error).
      ] = [
        // 1. Automation ROI — workflow runs, auto-sent comms, compliance blocks
        await tx.execute(sql`
          SELECT
            (SELECT COUNT(*)::int FROM workflow_runs
              WHERE status = 'completed' AND completed_at >= ${startOfMonth}) AS runs_mtd,
            (SELECT COUNT(*)::int FROM communications
              WHERE workflow_run_id IS NOT NULL
                AND sent_at >= ${startOfMonth}) AS auto_sent_mtd,
            (SELECT COUNT(*)::int FROM communications
              WHERE status = 'skipped_compliance'
                AND created_at >= ${startOfMonth}) AS compliance_blocks_mtd,
            (SELECT COUNT(*)::int FROM tasks
              WHERE workflow_run_id IS NOT NULL
                AND created_at >= ${startOfMonth}) AS auto_tasks_mtd
        `),

        // 2. Service Promise Adherence — % of clients reviewed on cadence per tier + SLA hit rate
        await tx.execute(sql`
          SELECT
            COUNT(*) FILTER (WHERE service_tier = 'A')::int AS a_total,
            COUNT(*) FILTER (WHERE service_tier = 'A' AND last_review_at >= ${last90})::int AS a_ok,
            COUNT(*) FILTER (WHERE service_tier = 'B')::int AS b_total,
            COUNT(*) FILTER (WHERE service_tier = 'B' AND last_review_at >= ${last180})::int AS b_ok,
            COUNT(*) FILTER (WHERE service_tier = 'C')::int AS c_total,
            COUNT(*) FILTER (WHERE service_tier = 'C' AND last_review_at >= ${last365})::int AS c_ok,
            (SELECT
              CASE WHEN COUNT(*) > 0
                THEN 100.0 * COUNT(*) FILTER (WHERE resolved_at IS NOT NULL
                  AND sla_resolution_at IS NOT NULL
                  AND resolved_at <= sla_resolution_at) / COUNT(*)
                ELSE NULL
              END
              FROM service_requests
              WHERE created_at >= ${last90}) AS sr_sla_hit_pct
          FROM investors WHERE status = 'active' AND deleted_at IS NULL
        `),

        // 3. Client Health Bands — read the PERSISTED health_band (the canonical
        // app-wide classification, written on create/update + nightly recompute
        // by src/lib/investors/health-persist.ts and shown on every investor
        // row + the health sort). This previously recomputed a *divergent*
        // inline formula per active investor — including a correlated EXISTS
        // subquery per row — which (a) disagreed with the canonical band used
        // everywhere else and omitted half its factors (PAN-Aadhaar, FATCA,
        // bank, risk-profile, dormancy), and (b) was the heaviest query in this
        // section at scale (O(active clients) scan + N correlated lookups).
        // A banded COUNT over the (tenant_id, status) index replaces all of it.
        await tx.execute(sql`
          SELECT
            COUNT(*) FILTER (WHERE health_band = 'green')::int AS green,
            COUNT(*) FILTER (WHERE health_band = 'amber')::int AS amber,
            COUNT(*) FILTER (WHERE health_band = 'red')::int AS red,
            COUNT(*)::int AS total
          FROM investors
          WHERE status = 'active' AND deleted_at IS NULL
        `),

        // 4. Compliance Waterfall — KYC, FATCA, risk profile, nominee, PAN-Aadhaar
        await tx.execute(sql`
          SELECT
            COUNT(*) FILTER (WHERE ckyc_expiry_at IS NOT NULL
              AND ckyc_expiry_at BETWEEN current_date AND current_date + interval '30 days')::int AS kyc_30,
            COUNT(*) FILTER (WHERE ckyc_expiry_at IS NOT NULL
              AND ckyc_expiry_at BETWEEN current_date + interval '30 days' AND current_date + interval '60 days')::int AS kyc_60,
            COUNT(*) FILTER (WHERE ckyc_expiry_at IS NOT NULL
              AND ckyc_expiry_at BETWEEN current_date + interval '60 days' AND current_date + interval '90 days')::int AS kyc_90,
            COUNT(*) FILTER (WHERE fatca_expiry_at IS NOT NULL
              AND fatca_expiry_at BETWEEN current_date AND current_date + interval '30 days')::int AS fatca_30,
            COUNT(*) FILTER (WHERE fatca_expiry_at IS NOT NULL
              AND fatca_expiry_at BETWEEN current_date + interval '30 days' AND current_date + interval '90 days')::int AS fatca_90,
            COUNT(*) FILTER (WHERE risk_profile_signed_at IS NULL
              OR risk_profile_signed_at < now() - interval '335 days')::int AS risk_profile_expiring,
            COUNT(*) FILTER (WHERE nominee_name IS NULL OR nominee_name = '')::int AS nominee_missing,
            COUNT(*) FILTER (WHERE pan_aadhaar_link_status IN ('not_linked', 'pending'))::int AS pan_aadhaar_missing
          FROM investors WHERE status = 'active' AND deleted_at IS NULL
        `),

        // 5. Recovery list — at-risk top 10 (redemption-risk flag, recent complaint, large recent outflow)
        await tx.execute(sql`
          WITH recent_complaint AS (
            SELECT investor_id FROM service_requests
            WHERE type IN ('complaint', 'redemption_help')
              AND created_at >= ${last30}
          ),
          recent_outflow AS (
            SELECT investor_id, SUM(amount::numeric) AS out_amt
            FROM transactions
            WHERE direction = 'outflow' AND status IN ('successful', 'processed')
              AND order_date >= current_date - interval '30 days'
            GROUP BY investor_id
            HAVING SUM(amount::numeric) > 50000
          )
          SELECT i.id, i.name, i.segment_tag, i.aum,
            i.redemption_risk_flagged_at IS NOT NULL AS redemption_flagged,
            (i.id IN (SELECT investor_id FROM recent_complaint)) AS has_complaint,
            COALESCE((SELECT out_amt FROM recent_outflow WHERE investor_id = i.id), 0) AS recent_outflow
          FROM investors i
          WHERE i.status = 'active' AND i.deleted_at IS NULL
            AND (
              i.redemption_risk_flagged_at IS NOT NULL
              OR i.id IN (SELECT investor_id FROM recent_complaint)
              OR i.id IN (SELECT investor_id FROM recent_outflow)
            )
          ORDER BY i.aum::numeric DESC NULLS LAST
          LIMIT 10
        `),

        // 6. Lost AUM watch — full exits in last 30 days
        await tx.execute(sql`
          SELECT
            COUNT(*)::int AS exit_count,
            COALESCE(SUM(GREATEST(lifetime_inflow::numeric - lifetime_outflow::numeric, 0)), 0)::numeric AS net_lost
          FROM investors
          WHERE status IN ('closed', 'exited')
            AND deleted_at IS NULL
            AND exited_at >= ${last30}
        `),

        // 7. AMC concentration — top 5 AMCs by AUM
        await tx.execute(sql`
          SELECT amc_name, SUM(aum::numeric)::numeric AS aum, COUNT(*)::int AS folio_count
          FROM folios
          WHERE aum::numeric > 0
          GROUP BY amc_name
          ORDER BY aum DESC NULLS LAST
          LIMIT 5
        `),

        // 8. Forward SIP projection — sum of active SIPs (next 30d expected inflow)
        await tx.execute(sql`
          SELECT
            COALESCE(SUM(amount::numeric), 0)::numeric AS monthly_sip_run,
            COUNT(*)::int AS active_sip_count
          FROM sips
          WHERE status = 'active'
        `),

        // 9. Inactive RM detector — per RM, % of book untouched in 60 days
        await tx.execute(sql`
          SELECT u.id, u.name AS rm_name,
            COUNT(i.id)::int AS total_clients,
            COUNT(i.id) FILTER (
              WHERE i.last_contact_at IS NULL OR i.last_contact_at < ${last60}
            )::int AS silent_clients,
            COALESCE(SUM(i.aum::numeric) FILTER (
              WHERE i.last_contact_at IS NULL OR i.last_contact_at < ${last60}
            ), 0)::numeric AS silent_aum
          FROM users u
          INNER JOIN investors i ON i.rm_id = u.id AND i.status = 'active' AND i.deleted_at IS NULL
          WHERE 'rm' = ANY(u.roles) AND u.status = 'active'
          GROUP BY u.id, u.name
          HAVING COUNT(i.id) > 0
          ORDER BY silent_clients DESC NULLS LAST
          LIMIT 5
        `),

        // 10. Review cadence per tier — already partly covered in #2, here we return per-RM split for the heatmap
        await tx.execute(sql`
          SELECT
            COALESCE(service_tier, 'Unassigned') AS tier,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (
              WHERE (service_tier = 'A' AND last_review_at >= ${last90})
                 OR (service_tier = 'B' AND last_review_at >= ${last180})
                 OR (service_tier = 'C' AND last_review_at >= ${last365})
            )::int AS on_cadence
          FROM investors
          WHERE status = 'active' AND deleted_at IS NULL
          GROUP BY service_tier
          ORDER BY tier
        `),
      ];

      const a = automation.rows[0] as any;
      const s = serviceAdherence.rows[0] as any;
      const h = healthBands.rows[0] as any;
      const c = compliance.rows[0] as any;
      const lost = lostAum.rows[0] as any;
      const sip = sipProjection.rows[0] as any;

      // Hours saved estimate: ~2 minutes per auto-sent comm + 5 minutes per workflow run + 3 min per auto-task
      const hoursSaved =
        (Number(a.auto_sent_mtd) * 2 + Number(a.runs_mtd) * 5 + Number(a.auto_tasks_mtd) * 3) / 60;

      const tierAdherence = (ok: number, total: number) =>
        total > 0 ? (ok / total) * 100 : null;

      const aPct = tierAdherence(Number(s.a_ok), Number(s.a_total));
      const bPct = tierAdherence(Number(s.b_ok), Number(s.b_total));
      const cPct = tierAdherence(Number(s.c_ok), Number(s.c_total));
      const overallReviewPct =
        Number(s.a_total) + Number(s.b_total) + Number(s.c_total) > 0
          ? ((Number(s.a_ok) + Number(s.b_ok) + Number(s.c_ok)) /
              (Number(s.a_total) + Number(s.b_total) + Number(s.c_total))) *
            100
          : null;

      const slaPct = s.sr_sla_hit_pct != null ? Number(s.sr_sla_hit_pct) : null;
      const promiseAdherence =
        overallReviewPct != null && slaPct != null
          ? (overallReviewPct + slaPct) / 2
          : overallReviewPct ?? slaPct;

      const totalAumForConcentration = (amcConcentration.rows as any[]).reduce(
        (sum, r) => sum + Number(r.aum),
        0
      );

      return {
        automation: {
          runsMtd: Number(a.runs_mtd),
          autoSentMtd: Number(a.auto_sent_mtd),
          complianceBlocksMtd: Number(a.compliance_blocks_mtd),
          autoTasksMtd: Number(a.auto_tasks_mtd),
          hoursSaved,
        },
        adherence: {
          promiseAdherence,
          aPct,
          bPct,
          cPct,
          aTotal: Number(s.a_total),
          bTotal: Number(s.b_total),
          cTotal: Number(s.c_total),
          slaPct,
        },
        health: {
          green: Number(h.green),
          amber: Number(h.amber),
          red: Number(h.red),
          total: Number(h.total),
        },
        compliance: {
          kyc30: Number(c.kyc_30),
          kyc60: Number(c.kyc_60),
          kyc90: Number(c.kyc_90),
          fatca30: Number(c.fatca_30),
          fatca90: Number(c.fatca_90),
          riskProfileExpiring: Number(c.risk_profile_expiring),
          nomineeMissing: Number(c.nominee_missing),
          panAadhaarMissing: Number(c.pan_aadhaar_missing),
        },
        recovery: recovery.rows as any[],
        lostAum: {
          exitCount: Number(lost.exit_count),
          netLost: Number(lost.net_lost),
        },
        amcConcentration: (amcConcentration.rows as any[]).map((r) => ({
          name: String(r.amc_name),
          aum: Number(r.aum),
          folios: Number(r.folio_count),
          pct: totalAumForConcentration > 0 ? (Number(r.aum) / totalAumForConcentration) * 100 : 0,
        })),
        sipProjection: {
          monthly: Number(sip.monthly_sip_run),
          count: Number(sip.active_sip_count),
        },
        rmActivity: rmActivity.rows as any[],
        reviewCadence: reviewCadence.rows as any[],
      };
    },
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );

  return (
    <div className="space-y-6">
      {/* ---------- Automation ROI strip ---------- */}
      <div className="card-surface glass-card p-5 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-brand-cyan-light/40 via-violet-50/30 to-transparent pointer-events-none" />
        <div className="relative">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold flex items-center gap-2 text-sm tracking-tight text-foreground/90">
              <div className="size-7 rounded-lg bg-brand-cyan-light grid place-items-center">
                <Bot className="size-3.5 text-brand-cyan-deep" />
              </div>
              Automation pulse — what the bots did for you this month
            </h2>
            <Link
              href="/dashboard/workflows/rules"
              className="text-xs text-brand-cyan-deep hover:underline font-semibold inline-flex items-center gap-1"
            >
              Workflows <ArrowRight className="size-3" />
            </Link>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <AutomationStat
              label="Workflow runs"
              value={data.automation.runsMtd.toLocaleString("en-IN")}
              sub="completed MTD"
            />
            <AutomationStat
              label="Comms auto-sent"
              value={data.automation.autoSentMtd.toLocaleString("en-IN")}
              sub="WA · email · SMS"
            />
            <AutomationStat
              label="Tasks auto-created"
              value={data.automation.autoTasksMtd.toLocaleString("en-IN")}
              sub="for team to action"
            />
            <AutomationStat
              label="Compliance blocks"
              value={data.automation.complianceBlocksMtd.toLocaleString("en-IN")}
              sub="bad sends stopped"
              tone={data.automation.complianceBlocksMtd > 0 ? "emerald" : "muted"}
            />
            <AutomationStat
              label="~Hours saved"
              value={data.automation.hoursSaved.toFixed(1)}
              sub="vs manual effort"
              tone="emerald"
              hero
            />
          </div>
        </div>
      </div>

      {/* ---------- Service Promise Adherence + Client Health Bands ---------- */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2 card-surface glass-card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold flex items-center gap-2 text-sm tracking-tight text-foreground/90">
              <div className="size-7 rounded-lg bg-emerald-50 grid place-items-center">
                <ShieldCheck className="size-3.5 text-emerald-700" />
              </div>
              Service promise adherence
            </h2>
            <span className="text-xs text-muted-foreground">Review cadence vs SLA hit-rate</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <PromiseGauge
              label="Overall"
              pct={data.adherence.promiseAdherence}
              hero
            />
            <PromiseGauge
              label="A-tier (Q)"
              pct={data.adherence.aPct}
              sub={`${data.adherence.aTotal} clients`}
            />
            <PromiseGauge
              label="B-tier (H)"
              pct={data.adherence.bPct}
              sub={`${data.adherence.bTotal} clients`}
            />
            <PromiseGauge
              label="C-tier (Y)"
              pct={data.adherence.cPct}
              sub={`${data.adherence.cTotal} clients`}
            />
          </div>
          <div className="text-xs text-muted-foreground bg-secondary/40 px-3 py-2 rounded-md">
            <span className="font-semibold">SLA hit-rate (last 90d):</span>{" "}
            {data.adherence.slaPct != null
              ? `${data.adherence.slaPct.toFixed(0)}% of service requests resolved within SLA`
              : "no SR data"}
          </div>
        </div>
        <div className="card-surface glass-card p-5">
          <h2 className="font-semibold flex items-center gap-2 text-sm tracking-tight text-foreground/90 mb-3">
            <div className="size-7 rounded-lg bg-rose-50 grid place-items-center">
              <Activity className="size-3.5 text-rose-600" />
            </div>
            Client health radar
          </h2>
          <div className="space-y-2.5">
            <HealthBand
              tone="emerald"
              label="Healthy"
              count={data.health.green}
              total={data.health.total}
              href="/dashboard/investors?health=green"
            />
            <HealthBand
              tone="amber"
              label="Watch"
              count={data.health.amber}
              total={data.health.total}
              href="/dashboard/investors?health=amber"
            />
            <HealthBand
              tone="rose"
              label="At-risk"
              count={data.health.red}
              total={data.health.total}
              href="/dashboard/investors?health=red"
            />
          </div>
          <p className="text-[10px] text-muted-foreground mt-3 leading-relaxed">
            Score blends last-contact, review cadence, KYC hygiene, nominee, redemption-risk
            flag and open SR SLA breaches.
          </p>
        </div>
      </div>

      {/* ---------- Compliance Waterfall ---------- */}
      <div className="card-surface glass-card p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold flex items-center gap-2 text-sm tracking-tight text-foreground/90">
            <div className="size-7 rounded-lg bg-amber-50 grid place-items-center">
              <ShieldCheck className="size-3.5 text-amber-700" />
            </div>
            Compliance waterfall — expiries & gaps
          </h2>
          <Link
            href="/dashboard/compliance"
            className="text-xs text-amber-700 hover:underline font-semibold inline-flex items-center gap-1"
          >
            Compliance <ArrowRight className="size-3" />
          </Link>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <ComplianceTile
            label="KYC — next 30d"
            value={data.compliance.kyc30}
            sub="CERSAI / CKYC expiry"
            tone={data.compliance.kyc30 > 0 ? "rose" : "muted"}
            href="/dashboard/investors?kyc_expiring=30"
          />
          <ComplianceTile
            label="KYC — 30-60d"
            value={data.compliance.kyc60}
            tone={data.compliance.kyc60 > 0 ? "amber" : "muted"}
            href="/dashboard/investors?kyc_expiring=60"
          />
          <ComplianceTile
            label="KYC — 60-90d"
            value={data.compliance.kyc90}
            tone={data.compliance.kyc90 > 0 ? "amber" : "muted"}
            href="/dashboard/investors?kyc_expiring=90"
          />
          <ComplianceTile
            label="FATCA — 30d"
            value={data.compliance.fatca30}
            tone={data.compliance.fatca30 > 0 ? "rose" : "muted"}
            href="/dashboard/investors?fatca_expiring=30"
          />
          <ComplianceTile
            label="Risk profile stale"
            value={data.compliance.riskProfileExpiring}
            sub="annual refresh due"
            tone={data.compliance.riskProfileExpiring > 0 ? "amber" : "muted"}
            href="/dashboard/risk-profiles"
          />
          <ComplianceTile
            label="Nominee missing"
            value={data.compliance.nomineeMissing}
            tone={data.compliance.nomineeMissing > 0 ? "rose" : "muted"}
            href="/dashboard/investors?nominee=missing"
          />
          <ComplianceTile
            label="PAN-Aadhaar unlinked"
            value={data.compliance.panAadhaarMissing}
            sub="SIPs may block"
            tone={data.compliance.panAadhaarMissing > 0 ? "rose" : "muted"}
            href="/dashboard/investors?pan_aadhaar=not_linked"
          />
          <ComplianceTile
            label="FATCA — 30-90d"
            value={data.compliance.fatca90}
            tone={data.compliance.fatca90 > 0 ? "amber" : "muted"}
            href="/dashboard/investors?fatca_expiring=90"
          />
        </div>
      </div>

      {/* ---------- Recovery list + Lost AUM watch ---------- */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2 card-surface glass-card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold flex items-center gap-2 text-sm tracking-tight text-foreground/90">
              <div className="size-7 rounded-lg bg-rose-50 grid place-items-center">
                <AlertTriangle className="size-3.5 text-rose-600" />
              </div>
              Recovery list — call them today
            </h2>
            <span className="text-xs text-muted-foreground">
              Flagged · complained · partially redeemed
            </span>
          </div>
          {data.recovery.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No clients at recovery risk right now. ✓
            </p>
          ) : (
            <ul className="divide-y">
              {data.recovery.map((r: any) => (
                <li key={r.id} className="py-2 flex items-center justify-between text-sm">
                  <Link
                    href={`/dashboard/investors/${r.id}`}
                    className="hover:underline flex-1"
                  >
                    <div className="font-medium">{r.name}</div>
                    <div className="text-[11px] text-muted-foreground flex flex-wrap gap-1.5 mt-0.5">
                      {r.segment_tag && (
                        <span className="chip bg-secondary text-[10px] py-0.5 px-1.5">
                          {r.segment_tag}
                        </span>
                      )}
                      {r.redemption_flagged && (
                        <span className="chip bg-rose-50 text-rose-700 text-[10px] py-0.5 px-1.5">
                          Redemption risk
                        </span>
                      )}
                      {r.has_complaint && (
                        <span className="chip bg-amber-50 text-amber-700 text-[10px] py-0.5 px-1.5">
                          Recent complaint
                        </span>
                      )}
                      {Number(r.recent_outflow) > 0 && (
                        <span className="chip bg-rose-50 text-rose-700 text-[10px] py-0.5 px-1.5">
                          Withdrew {formatINR(Number(r.recent_outflow))}
                        </span>
                      )}
                    </div>
                  </Link>
                  <div className="text-right">
                    <div className="text-xs font-semibold tabular-nums">
                      {formatINR(Number(r.aum))}
                    </div>
                    <div className="text-[10px] text-muted-foreground">AUM</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="card-surface glass-card p-5">
          <h2 className="font-semibold flex items-center gap-2 text-sm tracking-tight text-foreground/90 mb-3">
            <div className="size-7 rounded-lg bg-rose-50 grid place-items-center">
              <TrendingDown className="size-3.5 text-rose-600" />
            </div>
            Lost AUM (30d)
          </h2>
          <div className="space-y-3">
            <div className="bg-rose-50/60 border border-rose-100 rounded-lg p-3">
              <div className="text-[10px] uppercase tracking-wider text-rose-700 font-semibold">
                Net lost from full exits
              </div>
              <div className="text-2xl font-bold text-rose-700 mt-1 tabular-nums">
                {formatINR(data.lostAum.netLost)}
              </div>
              <div className="text-[11px] text-rose-700/80 mt-0.5">
                {data.lostAum.exitCount} client{data.lostAum.exitCount === 1 ? "" : "s"} closed
              </div>
            </div>
            <Link
              href="/dashboard/reports/exits"
              className="block text-xs text-rose-700 hover:underline font-semibold text-center"
            >
              Open exit analysis →
            </Link>
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              Tracks `lifetime_inflow − lifetime_outflow` for investors moved to
              <code className="text-[10px]"> closed</code> /
              <code className="text-[10px]"> exited</code> in the last 30 days.
            </p>
          </div>
        </div>
      </div>

      {/* ---------- AMC concentration + Forward SIP projection ---------- */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2 card-surface glass-card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold flex items-center gap-2 text-sm tracking-tight text-foreground/90">
              <div className="size-7 rounded-lg bg-violet-50 grid place-items-center">
                <Building2 className="size-3.5 text-violet-600" />
              </div>
              AMC concentration risk
            </h2>
            <span className="text-xs text-muted-foreground">
              Top 5 by AUM share
            </span>
          </div>
          {data.amcConcentration.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No folio AUM data yet.
            </p>
          ) : (
            <div className="space-y-2.5">
              {data.amcConcentration.map((a: any) => (
                <div key={a.name}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="font-medium truncate max-w-[60%]">{a.name}</span>
                    <span className="tabular-nums">
                      {formatINR(a.aum)} ·{" "}
                      <span
                        className={
                          a.pct > 40
                            ? "text-rose-600 font-semibold"
                            : a.pct > 25
                            ? "text-amber-600 font-semibold"
                            : "text-muted-foreground"
                        }
                      >
                        {a.pct.toFixed(1)}%
                      </span>
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        a.pct > 40
                          ? "bg-rose-500"
                          : a.pct > 25
                          ? "bg-amber-500"
                          : "bg-brand-cyan"
                      }`}
                      style={{ width: `${Math.min(100, a.pct)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="card-surface glass-card p-5">
          <h2 className="font-semibold flex items-center gap-2 text-sm tracking-tight text-foreground/90 mb-3">
            <div className="size-7 rounded-lg bg-emerald-50 grid place-items-center">
              <Briefcase className="size-3.5 text-emerald-600" />
            </div>
            Forward SIP visibility
          </h2>
          <div className="bg-emerald-50/40 border border-emerald-100 rounded-lg p-4">
            <div className="text-[10px] uppercase tracking-wider text-emerald-800 font-semibold">
              Expected next month
            </div>
            <div className="text-2xl font-bold text-emerald-800 mt-1 tabular-nums">
              {formatINR(data.sipProjection.monthly)}
            </div>
            <div className="text-[11px] text-emerald-800/80 mt-0.5">
              from {data.sipProjection.count.toLocaleString("en-IN")} active SIPs
            </div>
          </div>
          <Link
            href="/dashboard/sips"
            className="block text-xs text-emerald-700 hover:underline font-semibold text-center mt-3"
          >
            Open SIP register →
          </Link>
        </div>
      </div>

      {/* ---------- Inactive-RM detector + Review cadence ---------- */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card-surface glass-card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold flex items-center gap-2 text-sm tracking-tight text-foreground/90">
              <div className="size-7 rounded-lg bg-rose-50 grid place-items-center">
                <UserX className="size-3.5 text-rose-600" />
              </div>
              Inactive RM detector
            </h2>
            <span className="text-xs text-muted-foreground">No contact 60d+</span>
          </div>
          {data.rmActivity.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No RMs with assigned clients.
            </p>
          ) : (
            <table className="w-full text-xs">
              <thead className="text-[10px] text-muted-foreground uppercase tracking-wider">
                <tr>
                  <th className="text-left pb-2">RM</th>
                  <th className="text-right pb-2">Silent</th>
                  <th className="text-right pb-2">% book</th>
                  <th className="text-right pb-2">AUM at risk</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.rmActivity.map((r: any) => {
                  const pct =
                    Number(r.total_clients) > 0
                      ? (Number(r.silent_clients) / Number(r.total_clients)) * 100
                      : 0;
                  return (
                    <tr key={r.id}>
                      <td className="py-2 font-medium truncate max-w-[120px]">
                        {r.rm_name.split(" ")[0]}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {r.silent_clients}/{r.total_clients}
                      </td>
                      <td
                        className={`py-2 text-right tabular-nums font-semibold ${
                          pct > 50
                            ? "text-rose-600"
                            : pct > 25
                            ? "text-amber-600"
                            : "text-foreground"
                        }`}
                      >
                        {pct.toFixed(0)}%
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {formatINR(Number(r.silent_aum))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <div className="card-surface glass-card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold flex items-center gap-2 text-sm tracking-tight text-foreground/90">
              <div className="size-7 rounded-lg bg-brand-cyan-light grid place-items-center">
                <CalendarCheck className="size-3.5 text-brand-cyan-deep" />
              </div>
              Review cadence by tier
            </h2>
            <span className="text-xs text-muted-foreground">A: 90d · B: 180d · C: 365d</span>
          </div>
          <div className="space-y-3">
            {data.reviewCadence.map((row: any) => {
              const pct =
                Number(row.total) > 0
                  ? (Number(row.on_cadence) / Number(row.total)) * 100
                  : 0;
              return (
                <div key={row.tier}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="font-semibold">
                      Tier {row.tier}{" "}
                      <span className="text-muted-foreground font-normal">
                        ({row.total} clients)
                      </span>
                    </span>
                    <span
                      className={`tabular-nums font-bold ${
                        pct >= 80
                          ? "text-emerald-700"
                          : pct >= 60
                          ? "text-amber-700"
                          : "text-rose-700"
                      }`}
                    >
                      {pct.toFixed(0)}% on cadence
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        pct >= 80
                          ? "bg-emerald-500"
                          : pct >= 60
                          ? "bg-amber-500"
                          : "bg-rose-500"
                      }`}
                      style={{ width: `${Math.min(100, pct)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <Link
            href="/dashboard/review-meetings"
            className="block text-xs text-brand-cyan-deep hover:underline font-semibold text-center mt-3"
          >
            Open review meetings →
          </Link>
        </div>
      </div>
    </div>
  );
}

/* ----------------------- presentational helpers ----------------------- */

function AutomationStat({
  label,
  value,
  sub,
  tone,
  hero,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "emerald" | "muted";
  hero?: boolean;
}) {
  const color =
    tone === "emerald" ? "text-emerald-700" : hero ? "text-brand-cyan-deep" : "text-foreground";
  return (
    <div className={`p-3 rounded-lg ${hero ? "bg-white/90 ring-1 ring-brand-cyan/30" : "bg-white/70"}`}>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
        {label}
      </div>
      <div className={`text-xl font-bold mt-1 tabular-nums tracking-tight ${color}`}>
        {value}
      </div>
      {sub && (
        <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>
      )}
    </div>
  );
}

function PromiseGauge({
  label,
  pct,
  sub,
  hero,
}: {
  label: string;
  pct: number | null;
  sub?: string;
  hero?: boolean;
}) {
  const color =
    pct == null
      ? "text-muted-foreground"
      : pct >= 80
      ? "text-emerald-700"
      : pct >= 60
      ? "text-amber-700"
      : "text-rose-700";
  return (
    <div className={`p-3 rounded-lg border ${hero ? "bg-emerald-50/50 border-emerald-100" : "bg-secondary/40 border-border/40"}`}>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
        {label}
      </div>
      <div className={`mt-1 tabular-nums font-bold ${hero ? "text-2xl" : "text-xl"} ${color}`}>
        {pct != null ? `${pct.toFixed(0)}%` : "—"}
      </div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function HealthBand({
  tone,
  label,
  count,
  total,
  href,
}: {
  tone: "emerald" | "amber" | "rose";
  label: string;
  count: number;
  total: number;
  href: string;
}) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  const bg =
    tone === "emerald" ? "bg-emerald-500" : tone === "amber" ? "bg-amber-500" : "bg-rose-500";
  const text =
    tone === "emerald"
      ? "text-emerald-700"
      : tone === "amber"
      ? "text-amber-700"
      : "text-rose-700";
  return (
    <Link href={href} className="block group">
      <div className="flex items-center justify-between text-xs mb-1">
        <span className={`font-semibold ${text}`}>{label}</span>
        <span className="tabular-nums">
          <span className={`font-bold ${text}`}>{count.toLocaleString("en-IN")}</span>
          <span className="text-muted-foreground"> / {total.toLocaleString("en-IN")}</span>
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
        <div
          className={`h-full rounded-full ${bg} group-hover:opacity-80 transition-opacity`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
    </Link>
  );
}

function ComplianceTile({
  label,
  value,
  sub,
  tone,
  href,
}: {
  label: string;
  value: number;
  sub?: string;
  tone?: "rose" | "amber" | "muted";
  href: string;
}) {
  const color =
    tone === "rose" ? "text-rose-700" : tone === "amber" ? "text-amber-700" : "text-foreground";
  const border =
    tone === "rose"
      ? "border-rose-100 bg-rose-50/40"
      : tone === "amber"
      ? "border-amber-100 bg-amber-50/40"
      : "border-border/40 bg-secondary/30";
  return (
    <Link
      href={href}
      className={`block p-3 rounded-lg border ${border} hover:shadow-sm transition-all`}
    >
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
        {label}
      </div>
      <div className={`text-xl font-bold mt-1 tabular-nums ${color}`}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
    </Link>
  );
}
