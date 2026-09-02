import React, { Suspense } from "react";
import { SetupChecklist } from "./SetupChecklist";
import Link from "next/link";
import { sql } from "drizzle-orm";
import { ArrowDownRight, ArrowUpRight, TrendingUp, Users, UserPlus } from "lucide-react";
import { withTenant } from "@/db/client";
import { formatINR } from "@/lib/utils";
import type { SessionUser } from "@/lib/auth/session";
import { DataGapsTile } from "./DataGapsTile";
import { SipPersistencyTile } from "./SipPersistencyTile";
import { resolvePeriodRange, type Period } from "@/lib/dashboard/period";
import { getDashboardThresholds } from "@/lib/dashboard/thresholds";
import { Sparkline } from "./Sparkline";
import { loadTenantLicense } from "@/lib/auth/license";
import { isDashboardWidgetVisible } from "@/config/dashboard-widgets";

// Async parts streamed via Suspense
import { GrowthRetentionSection } from "./GrowthRetentionSection";
import { AttentionQueuesSection } from "./AttentionQueuesSection";
import { RmLeaderboard } from "./RmLeaderboard";
import { LeadFunnelSection } from "./LeadFunnelSection";
import { AumSegmentSection } from "./AumSegmentSection";
import { CardSkeleton, ChartSkeleton, LeaderboardSkeleton } from "./DashboardSkeletons";

/** Build a "?period=…(&pstart=…)" query suffix so drill-down links open scoped
 *  to the same window the cockpit is showing. Returns "" for the default (mtd,
 *  no custom start) so plain links stay clean. */
function buildPeriodQuery(period: Period, customStart?: string, customFrom?: string, customTo?: string): string {
  const params = new URLSearchParams();
  if (period !== "mtd") params.set("period", period);
  if (period === "custom") {
    if (customFrom) params.set("pfrom", customFrom);
    if (customTo) params.set("pto", customTo);
    if (!customFrom && customStart) params.set("pstart", customStart);
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/** Append the period query to an href, merging correctly whether the href
 *  already has its own params or not. */
function withPeriod(href: string, periodQuery: string): string {
  if (!periodQuery) return href;
  return href.includes("?") ? `${href}&${periodQuery.slice(1)}` : `${href}${periodQuery}`;
}

/**
 * MFD Owner Cockpit — spec § 6, Module 2.
 *
 * The hero + period selector render INSTANTLY; the data-heavy body (5 sequential
 * KPI queries + streamed sections) is wrapped in Suspense so switching the date
 * filter feels immediate — you get the shell + a skeleton straight away instead
 * of waiting for every query to resolve before the page paints.
 *
 * Body renders all 20 cards/charts the spec calls out:
 *   1. Headline (4) — Total Leads, Total Clients, Active SIP Book, Net Business
 *   2. Monthly business (5) — SIP added, Lumpsum, Redemption, SIP rejected, stopped
 *   3. Attention queues (5) — Reviews due, Pending SR, Open complaints, High-AUM, Dormant
 *   4. Team & health (4) — Team tasks, DDQ score, Data quality score, Campaigns
 *   5. Trends — Lead conversion %, RM-wise business, 30-day net sales chart
 */
export async function OwnerCockpit({
  session,
  period = "mtd",
  customStart,
  customFrom,
  customTo,
}: {
  session: SessionUser;
  period?: Period;
  customStart?: string;
  customFrom?: string;
  customTo?: string;
}) {
  const now = new Date();
  const today = now.toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Hero — renders immediately so the date filter is responsive even while
          the body below is still resolving its queries. */}
      <div className="card-elevated overflow-hidden">
        <div className="brand-mesh px-6 py-5 text-white">
          <div className="flex items-end justify-between flex-wrap gap-3">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">
                Welcome back, {session.name.split(" ")[0]}
              </h1>
              <p className="text-white/80 text-sm mt-1">
                Showing Data For : <span className="font-semibold">{today}</span>
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* First-run setup checklist — data-verified steps; vanishes when done. */}
      <Suspense fallback={null}>
        <SetupChecklist tenantId={session.tenantId} />
      </Suspense>

      <Suspense fallback={<CockpitBodySkeleton />}>
        <OwnerCockpitBody session={session} period={period} customStart={customStart} customFrom={customFrom} customTo={customTo} />
      </Suspense>
    </div>
  );
}

function CockpitBodySkeleton() {
  return (
    <div className="space-y-6">
      <div className="h-11 rounded-xl bg-card border border-border/50 animate-pulse" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-28 rounded-xl bg-card border border-border/50 animate-pulse" />
        ))}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-20 rounded-xl bg-card border border-border/50 animate-pulse" />
        ))}
      </div>
    </div>
  );
}

async function OwnerCockpitBody({
  session,
  period = "mtd",
  customStart,
  customFrom,
  customTo,
}: {
  session: SessionUser;
  period?: Period;
  customStart?: string;
  customFrom?: string;
  customTo?: string;
}) {
  const now = new Date();
  // Resolve period → start/end range. All "MTD" aggregates in the queries below
  // use this start instead of the hard-coded startOfMonth, and the net-sales
  // chart honours the SAME window so it matches the KPI tiles.
  const range = resolvePeriodRange(period, now, { customStart, from: customFrom, to: customTo });
  const { fromISO: startOfPeriodISO, toISO: endOfPeriodISO, label: periodLabel, days: rangeDays } = range;
  // Keep the original variable name so existing SQL template literals stay unchanged.
  const startOfMonthISO = startOfPeriodISO;

  // Business-logic thresholds — sourced from the central config, not magic numbers.
  const thresholds = getDashboardThresholds(session.tenantId);
  const dormantCutoff = new Date(
    Date.now() - thresholds.dormancyDays * 24 * 60 * 60 * 1000
  ).toISOString();

  // Drill-down links carry the active window so the destination opens scoped.
  const periodQuery = buildPeriodQuery(period, customStart, customFrom, customTo);

  // Chart bucketing: short ranges stay daily for resolution; longer ranges
  // bucket by week so the x-axis doesn't turn into a comb of 90+ ticks.
  const netSalesGranularity: "day" | "week" = rangeDays < 14 ? "day" : "week";

  const data = await withTenant(
    session.tenantId,
    async (tx) => {
      // Streamlined main cockpit query: only fetch core KPIs immediately
      // These queries share the single transaction connection, so Promise.all
      // can't parallelize them — pg runs one query per connection at a time (it
      // queued them and logged a deprecation warning that pg@9 turns into an
      // error). Sequential await is correct, warning-free, and connection-efficient.
      // ---------- 1. Headline counts (+ period trajectory deltas) ----------
      const headline = await tx.execute(sql`
        SELECT
          (SELECT COUNT(*)::int FROM investors WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active' AND deleted_at IS NULL) AS total_clients,
          (SELECT COUNT(*)::int FROM leads WHERE tenant_id = ${session.tenantId}::uuid AND converted_investor_id IS NULL AND stage NOT IN ('lost', 'cold', 'not_interested')) AS total_leads,
          (SELECT COALESCE(SUM(active_sip_amount::numeric), 0)::numeric FROM investors WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active' AND deleted_at IS NULL) AS sip_book,
          (SELECT COALESCE(SUM(aum::numeric), 0)::numeric FROM investors WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active' AND deleted_at IS NULL) AS total_aum,
          -- trajectory: clients onboarded this period
          (SELECT COUNT(*)::int FROM investors
            WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active' AND deleted_at IS NULL AND onboarded_at >= ${startOfMonthISO}) AS new_clients_period,
          -- trajectory: net new SIPs this period (registered minus stopped)
          (SELECT COUNT(*)::int FROM sips
            WHERE tenant_id = ${session.tenantId}::uuid AND created_at >= ${startOfMonthISO}) AS new_sips_period,
          (SELECT COUNT(*)::int FROM sips
            WHERE tenant_id = ${session.tenantId}::uuid AND status IN ('stopped','paused','cancelled') AND updated_at >= ${startOfMonthISO}) AS stopped_sips_period,
          (SELECT COALESCE(SUM(amount::numeric), 0)::numeric FROM sips
            WHERE tenant_id = ${session.tenantId}::uuid AND created_at >= ${startOfMonthISO})::numeric AS new_sip_amt_period
      `);

      // ---------- 2. Monthly business breakdown ----------
      // Sourced from the BUSINESS ENTRIES ledger (what the firm books), not the
      // RTA `transactions` feed — so the cards reflect manually-entered business.
      // SIP added/lumpsum/redemption/stopped map to business_entry_lines.txn_type;
      // SIP rejected has no business-entry equivalent (a rejection isn't booked
      // business) so it stays on sip_rejections.
      const business = await tx.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE l.txn_type IN ('sip','sip_topup'))::int AS sip_added_count,
          COALESCE(SUM(l.amount::numeric) FILTER (WHERE l.txn_type IN ('sip','sip_topup')), 0)::numeric AS sip_added_amt,
          COUNT(*) FILTER (WHERE l.txn_type IN ('lumpsum','additional_purchase'))::int AS lumpsum_count,
          COALESCE(SUM(l.amount::numeric) FILTER (WHERE l.txn_type IN ('lumpsum','additional_purchase')), 0)::numeric AS lumpsum_amt,
          COALESCE(SUM(l.amount::numeric) FILTER (WHERE l.txn_type IN ('redemption','swp')), 0)::numeric AS redemption_amt,
          COUNT(*) FILTER (WHERE l.txn_type = 'sip_stop')::int AS sip_stopped_count,
          (SELECT COUNT(*)::int FROM sip_rejections sr
             WHERE sr.tenant_id = ${session.tenantId}::uuid
               AND sr.rejection_date >= ${startOfMonthISO}::date) AS sip_rejected_count
        FROM business_entry_lines l
        JOIN business_entries e ON e.id = l.entry_id
        WHERE e.tenant_id = ${session.tenantId}::uuid
          AND e.status <> 'cancelled'
          AND e.business_date >= ${startOfMonthISO}::date
      `);

      // ---------- 2c. Business summary — net flows by asset class + product ----------
      // Detailed MIS the owner asked for: SIP (new/stop/net), Equity & Liquid
      // (purchase/redemption/net), the combined total, PMS/AIF/SIF, and new
      // insurance premium. Mutual-fund asset-class metrics are scoped to
      // product_type mutual_fund/direct_equity so PMS/AIF/SIF (whose lines may
      // carry an equity class) are counted ONCE, in their own tiles.
      const bizFlows = await tx.execute(sql`
        WITH lines AS (
          SELECT l.amount::numeric AS amt, l.txn_type, l.asset_class, l.from_asset_class,
                 (e.product_type IN ('mutual_fund','direct_equity')) AS mf
          FROM business_entry_lines l
          JOIN business_entries e ON e.id = l.entry_id
          WHERE e.tenant_id = ${session.tenantId}::uuid
            AND e.status <> 'cancelled'
            AND e.business_date >= ${startOfPeriodISO}::date
            AND e.business_date <= ${endOfPeriodISO}::date
        )
        SELECT
          COALESCE(SUM(amt) FILTER (WHERE mf AND txn_type IN ('sip','sip_topup')), 0)::numeric AS new_sip,
          COALESCE(SUM(amt) FILTER (WHERE mf AND txn_type = 'sip_stop'), 0)::numeric AS sip_stop,
          COALESCE(SUM(amt) FILTER (WHERE mf AND asset_class = 'equity' AND txn_type IN ('lumpsum','additional_purchase','switch','stp')), 0)::numeric AS eq_pur,
          COALESCE(SUM(amt) FILTER (WHERE mf AND ((txn_type IN ('redemption','swp') AND asset_class = 'equity') OR (txn_type IN ('switch','stp') AND from_asset_class = 'equity'))), 0)::numeric AS eq_red,
          COALESCE(SUM(amt) FILTER (WHERE mf AND asset_class = 'liquid' AND txn_type IN ('lumpsum','additional_purchase','switch','stp')), 0)::numeric AS liq_pur,
          COALESCE(SUM(amt) FILTER (WHERE mf AND ((txn_type IN ('redemption','swp') AND asset_class = 'liquid') OR (txn_type IN ('switch','stp') AND from_asset_class = 'liquid'))), 0)::numeric AS liq_red,
          COALESCE(SUM(amt) FILTER (WHERE mf AND txn_type IN ('lumpsum','additional_purchase','switch','stp')), 0)::numeric AS total_pur
        FROM lines
      `);
      const bizProducts = await tx.execute(sql`
        SELECT
          COALESCE(SUM(total_amount::numeric) FILTER (WHERE product_type = 'pms'), 0)::numeric AS pms,
          COALESCE(SUM(total_amount::numeric) FILTER (WHERE product_type = 'aif'), 0)::numeric AS aif,
          COALESCE(SUM(total_amount::numeric) FILTER (WHERE product_type = 'sif'), 0)::numeric AS sif
        FROM business_entries
        WHERE tenant_id = ${session.tenantId}::uuid
          AND status <> 'cancelled'
          AND business_date >= ${startOfPeriodISO}::date
          AND business_date <= ${endOfPeriodISO}::date
      `);
      const insBiz = await tx.execute(sql`
        SELECT COALESCE(SUM(annual_premium::numeric), 0)::numeric AS premium, COUNT(*)::int AS cnt
        FROM insurance_policies
        WHERE tenant_id = ${session.tenantId}::uuid
          AND status <> 'cancelled'
          AND policy_start_date IS NOT NULL
          AND policy_start_date >= ${startOfPeriodISO}::date
          AND policy_start_date <= ${endOfPeriodISO}::date
      `);

      // NB: "SIP stopped this period" is already computed as stopped_sips_period
      // in the headline query above — reuse it instead of a second round-trip.

      // ---------- 3. Attention queues (fast stats for summary bar) ----------
      const queues = await tx.execute(sql`
        SELECT
          (SELECT COUNT(*)::int FROM investors
              WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active' AND deleted_at IS NULL AND next_review_at IS NOT NULL
                AND next_review_at <= now()) AS reviews_due,
          (SELECT COUNT(*)::int FROM service_requests
              WHERE tenant_id = ${session.tenantId}::uuid AND status IN ('open', 'in_progress')) AS sr_pending,
          (SELECT COUNT(*)::int FROM service_requests
              WHERE tenant_id = ${session.tenantId}::uuid AND status IN ('open', 'in_progress') AND type = 'complaint') AS complaints_open,
          (SELECT COUNT(*)::int FROM investors
              WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active' AND deleted_at IS NULL AND service_tier = 'A'
                AND (last_review_at IS NULL OR last_review_at < now() - make_interval(days => ${thresholds.hniReviewDays}))) AS hni_not_reviewed,
          (SELECT COUNT(*)::int FROM investors
              WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active' AND deleted_at IS NULL
                AND (last_transaction_at IS NULL OR last_transaction_at < ${dormantCutoff})) AS dormant_clients
      `);

      // ---------- 4. Team & health ----------
      const team = await tx.execute(sql`
        SELECT
          (SELECT COUNT(*)::int FROM tasks WHERE tenant_id = ${session.tenantId}::uuid AND status = 'open') AS team_tasks,
          (SELECT COUNT(*)::int FROM campaigns WHERE tenant_id = ${session.tenantId}::uuid AND status IN ('sending', 'scheduled')) AS campaigns_running,
          (SELECT overall_score::numeric FROM ddq_scores WHERE tenant_id = ${session.tenantId}::uuid ORDER BY computed_at DESC LIMIT 1) AS ddq_score,
          (SELECT (
              100.0 * COUNT(*) FILTER (WHERE pan IS NOT NULL AND pan <> ''
                AND email IS NOT NULL AND email <> ''
                AND phone IS NOT NULL AND phone <> ''
                AND dob IS NOT NULL
                AND nominee_name IS NOT NULL AND nominee_name <> ''
                AND bank_account_masked IS NOT NULL AND bank_account_masked <> '')
              / NULLIF(COUNT(*), 0)
            )::numeric FROM investors WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active' AND deleted_at IS NULL) AS data_quality_score
      `);

      // ---------- 5. Lead conversion (fast stats for KPI delta) ----------
      const leadFunnel = await tx.execute(sql`
        SELECT
          COUNT(*)::int AS total_leads_mtd,
          COUNT(*) FILTER (WHERE converted_investor_id IS NOT NULL)::int AS converted_mtd
        FROM leads
        WHERE tenant_id = ${session.tenantId}::uuid
          AND created_at >= ${startOfMonthISO}
      `);

      // ---------- 6. Net-sales series — period-scoped, day or week buckets ----------
      // Generates a continuous bucket series across the SELECTED window (so the
      // chart matches the KPI tiles), then LEFT JOINs transactions onto it so
      // gaps render as zeros rather than missing points.
      const netSeries = await tx.execute(
        netSalesGranularity === "week"
          ? sql`
              WITH buckets AS (
                SELECT generate_series(
                  date_trunc('week', ${startOfPeriodISO}::timestamptz),
                  date_trunc('week', ${endOfPeriodISO}::timestamptz),
                  interval '1 week'
                )::date AS b
              )
              SELECT buckets.b::text AS day,
                COALESCE(SUM(CASE WHEN t.direction = 'inflow' THEN t.amount::numeric END), 0)::numeric AS gross,
                COALESCE(SUM(CASE WHEN t.direction = 'outflow' THEN t.amount::numeric END), 0)::numeric AS redemption,
                COALESCE(SUM(CASE WHEN t.direction = 'inflow' THEN t.amount::numeric ELSE -t.amount::numeric END), 0)::numeric AS net
              FROM buckets LEFT JOIN transactions t
                ON date_trunc('week', t.order_date)::date = buckets.b
                AND t.tenant_id = ${session.tenantId}::uuid
                AND t.status IN ('processed', 'successful')
              GROUP BY buckets.b ORDER BY buckets.b
            `
          : sql`
              WITH buckets AS (
                SELECT generate_series(
                  ${startOfPeriodISO}::date,
                  ${endOfPeriodISO}::date,
                  interval '1 day'
                )::date AS b
              )
              SELECT buckets.b::text AS day,
                COALESCE(SUM(CASE WHEN t.direction = 'inflow' THEN t.amount::numeric END), 0)::numeric AS gross,
                COALESCE(SUM(CASE WHEN t.direction = 'outflow' THEN t.amount::numeric END), 0)::numeric AS redemption,
                COALESCE(SUM(CASE WHEN t.direction = 'inflow' THEN t.amount::numeric ELSE -t.amount::numeric END), 0)::numeric AS net
              FROM buckets LEFT JOIN transactions t
                ON t.order_date = buckets.b
                AND t.tenant_id = ${session.tenantId}::uuid
                AND t.status IN ('processed', 'successful')
              GROUP BY buckets.b ORDER BY buckets.b
            `
      );

      // ---------- 7. Hero sparkline series — per-day net business across the period ----------
      // Cheap daily roll-up from the business-entries ledger (same source the
      // Net Business KPI uses): one row per day, net = sip + lumpsum - redemption.
      const netBizDaily = await tx.execute(sql`
        WITH days AS (
          SELECT generate_series(${startOfPeriodISO}::date, ${endOfPeriodISO}::date, interval '1 day')::date AS d
        )
        SELECT days.d::text AS day,
          COALESCE(SUM(
            CASE
              WHEN l.txn_type IN ('sip','sip_topup','lumpsum','additional_purchase') THEN l.amount::numeric
              WHEN l.txn_type IN ('redemption','swp') THEN -l.amount::numeric
              ELSE 0
            END
          ), 0)::numeric AS net
        FROM days
        LEFT JOIN business_entries e
          ON e.tenant_id = ${session.tenantId}::uuid
          AND e.status <> 'cancelled'
          AND e.business_date = days.d
        LEFT JOIN business_entry_lines l ON l.entry_id = e.id
        GROUP BY days.d ORDER BY days.d
      `);

      // ---------- 8. SIP book sparkline — cumulative active SIP amount per day ----------
      // Daily registered-SIP amount across the period (the incremental adds that
      // build the book). Kept as a per-day add series — a true running balance
      // would need historical snapshots we don't store.
      const sipAddDaily = await tx.execute(sql`
        WITH days AS (
          SELECT generate_series(${startOfPeriodISO}::date, ${endOfPeriodISO}::date, interval '1 day')::date AS d
        )
        SELECT days.d::text AS day,
          COALESCE(SUM(s.amount::numeric), 0)::numeric AS amt
        FROM days
        LEFT JOIN sips s
          ON s.tenant_id = ${session.tenantId}::uuid
          AND s.created_at::date = days.d
        GROUP BY days.d ORDER BY days.d
      `);

      // Unpack the results into the shape the JSX expects.
      const h = headline.rows[0] as any;
      const b = business.rows[0] as any;
      const q = queues.rows[0] as any;
      const t = team.rows[0] as any;
      const lf = leadFunnel.rows[0] as any;
      const bf = bizFlows.rows[0] as any;
      const bp = bizProducts.rows[0] as any;
      const ib = insBiz.rows[0] as any;
      const netBusiness =
        Number(b.sip_added_amt) + Number(b.lumpsum_amt) - Number(b.redemption_amt);
      const conversionPct =
        Number(lf.total_leads_mtd) > 0
          ? (Number(lf.converted_mtd) / Number(lf.total_leads_mtd)) * 100
          : 0;

      return {
        // headline
        totalClients: Number(h.total_clients),
        totalLeads: Number(h.total_leads),
        sipBook: Number(h.sip_book),
        totalAum: Number(h.total_aum),
        // trajectory deltas (this period)
        newClientsPeriod: Number(h.new_clients_period ?? 0),
        newSipsPeriod: Number(h.new_sips_period ?? 0),
        stoppedSipsPeriod: Number(h.stopped_sips_period ?? 0),
        newSipAmtPeriod: Number(h.new_sip_amt_period ?? 0),
        // business
        sipAddedCount: Number(b.sip_added_count),
        sipAddedAmt: Number(b.sip_added_amt),
        lumpsumCount: Number(b.lumpsum_count),
        lumpsumAmt: Number(b.lumpsum_amt),
        redemptionAmt: Number(b.redemption_amt),
        sipRejectedCount: Number(b.sip_rejected_count),
        sipStoppedCount: Number(b.sip_stopped_count ?? 0),
        netBusiness,
        // detailed business summary (net flows by asset class + product)
        bizSummary: {
          newSip: Number(bf.new_sip), sipStop: Number(bf.sip_stop),
          eqPur: Number(bf.eq_pur), eqRed: Number(bf.eq_red),
          liqPur: Number(bf.liq_pur), liqRed: Number(bf.liq_red),
          totalPur: Number(bf.total_pur),
          pms: Number(bp.pms), aif: Number(bp.aif), sif: Number(bp.sif),
          insPremium: Number(ib.premium), insCount: Number(ib.cnt),
        },
        // queues
        reviewsDue: Number(q.reviews_due),
        srPending: Number(q.sr_pending),
        complaintsOpen: Number(q.complaints_open),
        hniNotReviewed: Number(q.hni_not_reviewed),
        dormantClients: Number(q.dormant_clients),
        // team
        teamTasks: Number(t.team_tasks),
        campaignsRunning: Number(t.campaigns_running),
        ddqScore: t.ddq_score != null ? Number(t.ddq_score) : null,
        dataQualityScore: t.data_quality_score != null ? Number(t.data_quality_score) : null,
        // conversion
        conversionPct,
        leadsMtd: Number(lf.total_leads_mtd),
        convertedMtd: Number(lf.converted_mtd),
        // chart + sparkline series (period-scoped)
        netSalesSeries: (netSeries.rows as any[]).map((r) => ({
          day: String(r.day),
          gross: Number(r.gross),
          redemption: Number(r.redemption),
          net: Number(r.net),
        })),
        netBizSpark: (netBizDaily.rows as any[]).map((r) => Number(r.net)),
        sipAddSpark: (sipAddDaily.rows as any[]).map((r) => Number(r.amt)),
      };
    },
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );

  // Admin → MFD dashboard-widget access. `allow` is the platform admin's grant
  // (null = show everything). `show(key)` decides per widget. loadTenantLicense
  // is request-cached, so this is the same read the layout already did.
  const license = await loadTenantLicense(session.tenantId, session.roles);
  const allow = license.allowedDashboardWidgets;
  const show = (key: string) => isDashboardWidgetVisible(allow, key);

  const anyHeadline =
    show("kpi.total_clients") ||
    show("kpi.open_leads") ||
    show("kpi.active_sip_book") ||
    show("kpi.net_business");
  const anyAnalytics =
    show("section.lead_funnel") ||
    show("section.aum_segment") ||
    show("section.rm_leaderboard");

  return (
    <div className="space-y-6">
      {/* ---------- 1. Headline KPIs — hero tiles (with period trajectory) ---------- */}
      {anyHeadline && (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {show("kpi.total_clients") && <Kpi
          href={withPeriod("/dashboard/investors", periodQuery)}
          icon={Users}
          label="Total Clients"
          value={String(data.totalClients)}
          sub={formatINR(data.totalAum) + " AUM"}
          delta={data.newClientsPeriod > 0 ? `+${data.newClientsPeriod} ${period.toUpperCase()}` : undefined}
          deltaTone="up"
          accent="cyan"
        />}
        {show("kpi.open_leads") && <Kpi
          href={withPeriod("/dashboard/leads", periodQuery)}
          icon={UserPlus}
          label="Open Leads"
          value={String(data.totalLeads)}
          sub={`${data.conversionPct.toFixed(1)}% conversion ${period.toUpperCase()}`}
          accent="violet"
        />}
        {show("kpi.active_sip_book") && <Kpi
          href={withPeriod("/dashboard/sips", periodQuery)}
          icon={TrendingUp}
          label="Active SIP Book"
          value={formatINR(data.sipBook)}
          sub="per month"
          delta={
            data.newSipsPeriod - data.stoppedSipsPeriod !== 0
              ? `${data.newSipsPeriod - data.stoppedSipsPeriod >= 0 ? "+" : ""}${data.newSipsPeriod - data.stoppedSipsPeriod} net SIPs`
              : undefined
          }
          deltaTone={data.newSipsPeriod - data.stoppedSipsPeriod >= 0 ? "up" : "down"}
          accent="emerald"
          sparkline={data.sipAddSpark}
          sparkStrokeClass="text-emerald-500"
        />}
        {show("kpi.net_business") && <Kpi
          href={withPeriod("/dashboard/reports/net_sales", periodQuery)}
          icon={TrendingUp}
          label={`Net Business ${period.toUpperCase()}`}
          value={formatINR(data.netBusiness)}
          sub={`Gross ${formatINR(data.sipAddedAmt + data.lumpsumAmt)}`}
          trend={data.netBusiness >= 0 ? "up" : "down"}
          hero
          sparkline={data.netBizSpark}
        />}
      </div>
      )}

      {/* ---------- Growth & retention — churn, tax-harvest, referrals, regulatory (streamed) ---------- */}
      {show("section.growth_retention") && (
      <Suspense fallback={<CardSkeleton />}>
        <GrowthRetentionSection session={session} />
      </Suspense>
      )}

      {/* ---------- 2b. Data gaps — fixes from MFD ops checklist ---------- */}
      {show("section.data_gaps") && <DataGapsTile />}

      {/* ---------- 3. Attention queues (streamed via Suspense) ---------- */}
      {show("section.attention_queues") && (
      <Suspense fallback={<CardSkeleton />}>
        <AttentionQueuesSection session={session} />
      </Suspense>
      )}

      {/* ---------- 5. Conversion + RM-wise + chart (streamed via Suspense) ---------- */}
      {anyAnalytics && (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {show("section.lead_funnel") && (
        <Suspense fallback={<ChartSkeleton />}>
          <LeadFunnelSection session={session} period={period} />
        </Suspense>
        )}

        {show("section.aum_segment") && (
        <Suspense fallback={<ChartSkeleton />}>
          <AumSegmentSection session={session} />
        </Suspense>
        )}

        {show("section.rm_leaderboard") && (
        <Suspense fallback={<LeaderboardSkeleton />}>
          <RmLeaderboard session={session} period={period} periodQuery={periodQuery} />
        </Suspense>
        )}
      </div>
      )}

      {/* ---------- SIP Persistency — franchise health metric ---------- */}
      {show("section.sip_persistency") && <SipPersistencyTile session={session} />}
    </div>
  );
}

/* ------------------------- presentational helpers ------------------------- */

function Group({
  title,
  link,
  children,
}: {
  title: string;
  link?: { href: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-4 w-1 rounded-full brand-bar" />
          <h2 className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/70">
            {title}
          </h2>
        </div>
        {link && (
          <Link
            href={link.href}
            className="text-xs text-brand-cyan-deep hover:underline font-medium"
          >
            {link.label} →
          </Link>
        )}
      </div>
      {children}
    </div>
  );
}

function Kpi({
  href,
  icon: Icon,
  label,
  value,
  sub,
  trend,
  accent,
  hero,
  delta,
  deltaTone,
  sparkline,
  sparkStrokeClass,
}: {
  href?: string;
  icon?: any;
  label: string;
  value: string;
  sub?: string;
  trend?: "up" | "down";
  accent?: "cyan" | "violet" | "emerald" | "amber";
  hero?: boolean;
  /** Small period-trajectory pill, e.g. "+23 MTD". */
  delta?: string;
  deltaTone?: "up" | "down";
  /** Optional per-period trend series; rendered only when it has ≥2 real points. */
  sparkline?: number[];
  sparkStrokeClass?: string;
}) {
  const TrendIcon = trend === "up" ? ArrowUpRight : trend === "down" ? ArrowDownRight : null;
  // Only render a sparkline when there's a real, non-flat series to show —
  // never fabricate a line out of all-zeros.
  const hasSpark =
    !!sparkline && sparkline.length >= 2 && sparkline.some((n) => n !== sparkline![0]);

  if (hero) {
    const inner = (
      <div className="kpi-hero relative overflow-hidden">
        <div className="flex items-center justify-between">
          <span className="text-[11px] uppercase tracking-wider font-semibold text-white/80">
            {label}
          </span>
          {Icon && (
            <div className="size-8 rounded-lg bg-white/15 grid place-items-center backdrop-blur-sm">
              <Icon className="size-4 text-white" />
            </div>
          )}
        </div>
        <div className="flex items-end justify-between gap-2 mt-2">
          <div className="text-3xl font-extrabold tabular-nums tracking-tight">{value}</div>
          {hasSpark && (
            <Sparkline data={sparkline!} strokeClass="text-white/80" width={72} height={28} />
          )}
        </div>
        {sub && (
          <div className="text-xs mt-2 flex items-center gap-1 text-white/85">
            {TrendIcon && (
              <TrendIcon
                className={`size-3.5 ${trend === "up" ? "text-emerald-300" : "text-rose-300"}`}
              />
            )}
            <span>{sub}</span>
          </div>
        )}
      </div>
    );
    return href ? <Link href={href}>{inner}</Link> : inner;
  }

  const iconBg: Record<string, string> = {
    cyan: "bg-brand-cyan-light text-brand-cyan-deep",
    violet: "bg-violet-50 text-violet-600",
    emerald: "bg-emerald-50 text-emerald-600",
    amber: "bg-amber-50 text-amber-600",
    default: "bg-secondary text-foreground",
  };
  const bg = iconBg[accent ?? "default"];
  const trendColor =
    trend === "up"
      ? "text-emerald-600"
      : trend === "down"
      ? "text-rose-600"
      : "text-muted-foreground";

  const inner = (
    <div className="kpi-card glass-card">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
          {label}
        </span>
        {Icon && (
          <div className={`size-8 rounded-lg grid place-items-center ${bg}`}>
            <Icon className="size-4" />
          </div>
        )}
      </div>
      <div className="flex items-baseline gap-2 mt-2 flex-wrap">
        <div className="text-2xl font-bold tabular-nums tracking-tight">{value}</div>
        {delta && (
          <span
            className={`inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
              deltaTone === "down"
                ? "bg-rose-50 text-rose-700"
                : "bg-emerald-50 text-emerald-700"
            }`}
          >
            {deltaTone === "down" ? (
              <ArrowDownRight className="size-2.5" />
            ) : (
              <ArrowUpRight className="size-2.5" />
            )}
            {delta}
          </span>
        )}
        {hasSpark && (
          <div className="ml-auto">
            <Sparkline
              data={sparkline!}
              strokeClass={sparkStrokeClass ?? "text-emerald-500"}
              width={72}
              height={24}
            />
          </div>
        )}
      </div>
      {sub && (
        <div className={`text-xs mt-2 flex items-center gap-1 ${trendColor}`}>
          {TrendIcon && <TrendIcon className="size-3" />}
          <span>{sub}</span>
        </div>
      )}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

function Stat({
  href,
  icon: Icon,
  label,
  value,
  sub,
  tone,
}: {
  href?: string;
  icon?: any;
  label: string;
  value: string;
  sub?: string;
  tone?: "rose" | "amber" | "emerald" | "muted";
}) {
  const color =
    tone === "rose"
      ? "text-rose-600"
      : tone === "amber"
      ? "text-amber-600"
      : tone === "emerald"
      ? "text-emerald-600"
      : "text-foreground";
  const iconBg =
    tone === "rose"
      ? "bg-rose-50 text-rose-600"
      : tone === "amber"
      ? "bg-amber-50 text-amber-600"
      : tone === "emerald"
      ? "bg-emerald-50 text-emerald-600"
      : "bg-brand-cyan-light text-brand-cyan-deep";

  const inner = (
    <div className="kpi-card glass-card">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
          {label}
        </span>
        {Icon && (
          <div className={`size-7 rounded-lg grid place-items-center ${iconBg}`}>
            <Icon className="size-3.5" />
          </div>
        )}
      </div>
      <div className={`text-xl font-bold mt-2 tabular-nums tracking-tight ${color}`}>
        {value}
      </div>
      {sub && <div className="text-[11px] text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}
