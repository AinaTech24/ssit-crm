/**
 * Referral Radar — the referral growth engine, both halves:
 *
 *   1. LIKELY REFERRERS — happy, sticky clients most worth asking for an intro
 *      RIGHT NOW. Transparent scorecard: active SIPs (+2), AUM at/above the firm
 *      median (+1), tenure ≥ 1 year (+1), has referred before (+1). Clients with
 *      a "Referral ask:" task created in the last 90 days are suppressed so the
 *      same person isn't hounded every week.
 *   2. REFERRAL LEADERBOARD — clients who already sent business, with conversion
 *      outcomes and the appreciation (gifts) shown against what they gave.
 *
 * Referrals are the #1 growth channel for Indian MFDs — this page turns the
 * book into a proactive ask-worklist instead of waiting for intros to happen.
 */

import Link from "next/link";
import { sql } from "drizzle-orm";
import { Radar, Trophy, Users, TrendingUp, Percent, CalendarClock, Gift } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny, can } from "@/lib/auth/rbac";
import { users } from "@/db/schema";
import { formatINR, formatDate } from "@/lib/utils";
import { ReferralAskButton } from "@/components/reports/ReferralAskButton";

export const dynamic = "force-dynamic";

type LikelyRow = {
  id: string;
  name: string;
  aum: string | number;
  rm_id: string | null;
  created_at: string;
  active_sips: number;
  referred_before: boolean;
  score: number;
};

type LeaderRow = {
  investor_id: string;
  name: string | null;
  referrals_given: number;
  converted: number;
  latest_referral: string;
  gift_total: string | number;
};

export default async function ReferralRadarPage() {
  const session = await requireSession();
  requireAny(
    session.roles,
    ["reports.business", "reports.team", "investor.view.all", "investor.view.assigned"],
    session.permissions
  );

  // Managers see the firm; a plain RM (assigned-scope only) sees just their book.
  const seesAll =
    can(session.roles, "investor.view.all", session.permissions) ||
    can(session.roles, "reports.business", session.permissions) ||
    can(session.roles, "reports.team", session.permissions);
  const bookScope = seesAll ? sql`` : sql` AND i.rm_id = ${session.userId}::uuid`;

  const data = await withTenant(
    session.tenantId,
    async (tx) => {
      // ── 1. Likely referrers — ONE set-based query, no N+1 ─────────────────
      // Scorecard: +2 active SIPs, +1 AUM ≥ firm median, +1 tenure ≥ 1yr,
      // +1 referred before. Suppress anyone with a recent "Referral ask:" task.
      const likely = await tx.execute(sql`
        WITH book AS (
          SELECT i.id, i.name, COALESCE(i.aum, 0)::numeric AS aum, i.rm_id, i.created_at
          FROM investors i
          WHERE i.status = 'active' AND i.deleted_at IS NULL${bookScope}
        ),
        med AS (
          SELECT COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY aum), 0) AS median_aum
          FROM book
        ),
        scored AS (
          SELECT
            b.id, b.name, b.aum, b.rm_id, b.created_at, m.median_aum,
            (SELECT count(*)::int FROM sips s
               WHERE s.investor_id = b.id AND s.status = 'active') AS active_sips,
            EXISTS (SELECT 1 FROM leads l
                      WHERE l.referred_by_investor_id = b.id) AS referred_before
          FROM book b CROSS JOIN med m
          WHERE NOT EXISTS (
            SELECT 1 FROM tasks t
            WHERE (t.related_investor_id = b.id OR t.subject_id = b.id)
              AND t.title ILIKE 'Referral ask:%'
              AND t.created_at >= now() - interval '90 days'
              AND t.deleted_at IS NULL
          )
        )
        SELECT * FROM (
          SELECT
            s.id, s.name, s.aum, s.rm_id, s.created_at, s.active_sips, s.referred_before,
            (
              (s.active_sips >= 1)::int * 2
              + (s.aum > 0 AND s.aum >= s.median_aum)::int
              + (s.created_at <= now() - interval '1 year')::int
              + s.referred_before::int
            ) AS score
          FROM scored s
        ) ranked
        WHERE score >= 1
        ORDER BY score DESC, aum DESC
        LIMIT 20
      `);

      // ── 2. Referral leaderboard — who already sent business ───────────────
      const leaderScope = seesAll
        ? sql``
        : sql` AND i.id IS NOT NULL AND i.rm_id = ${session.userId}::uuid`;
      const leaders = await tx.execute(sql`
        SELECT
          l.referred_by_investor_id AS investor_id,
          i.name AS name,
          COUNT(*)::int AS referrals_given,
          COUNT(*) FILTER (WHERE l.converted_investor_id IS NOT NULL)::int AS converted,
          MAX(l.created_at) AS latest_referral,
          COALESCE(g.gift_total, 0)::numeric AS gift_total
        FROM leads l
        LEFT JOIN investors i
          ON i.id = l.referred_by_investor_id AND i.deleted_at IS NULL
        LEFT JOIN (
          SELECT investor_id, SUM(amount)::numeric AS gift_total
          FROM client_gifts GROUP BY investor_id
        ) g ON g.investor_id = l.referred_by_investor_id
        WHERE l.referred_by_investor_id IS NOT NULL${leaderScope}
        GROUP BY l.referred_by_investor_id, i.name, g.gift_total
        ORDER BY referrals_given DESC, converted DESC, latest_referral DESC
        LIMIT 15
      `);

      // ── KPI strip — the referral channel at a glance ───────────────────────
      const kpiScope = seesAll
        ? sql``
        : sql` AND (l.owner_id = ${session.userId}::uuid OR EXISTS (
              SELECT 1 FROM investors ri
              WHERE ri.id = l.referred_by_investor_id AND ri.rm_id = ${session.userId}::uuid))`;
      const kpi = (
        await tx.execute(sql`
          SELECT
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE l.converted_investor_id IS NOT NULL)::int AS converted,
            COUNT(*) FILTER (WHERE l.created_at >= now() - interval '90 days')::int AS last_90
          FROM leads l
          WHERE (l.referred_by_investor_id IS NOT NULL OR l.source IN ('referral', 'existing_client'))${kpiScope}
        `)
      ).rows[0] as any;

      const rmRows = await tx.select({ id: users.id, name: users.name }).from(users);
      const rmMap = new Map(rmRows.map((r) => [r.id, r.name]));

      return {
        likely: likely.rows as unknown as LikelyRow[],
        leaders: leaders.rows as unknown as LeaderRow[],
        kpi,
        rmMap,
      };
    },
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );

  const totalReferrals = Number(data.kpi?.total ?? 0);
  const convertedReferrals = Number(data.kpi?.converted ?? 0);
  const last90 = Number(data.kpi?.last_90 ?? 0);
  const conversionPct = totalReferrals > 0 ? Math.round((convertedReferrals / totalReferrals) * 100) : null;

  const tenureYears = (createdAt: string) =>
    (Date.now() - new Date(createdAt).getTime()) / (365.25 * 24 * 60 * 60 * 1000);

  const signalsFor = (r: LikelyRow): string[] => {
    const out: string[] = [];
    const yrs = tenureYears(r.created_at);
    if (r.active_sips >= 1)
      out.push(`${r.active_sips} active SIP${r.active_sips > 1 ? "s" : ""} — committed, recurring investor`);
    if (Number(r.aum) > 0) out.push(`AUM ${formatINR(Number(r.aum))}`);
    if (yrs >= 1) out.push(`Client for ${yrs.toFixed(1)} years`);
    if (r.referred_before) out.push("Has referred before — proven advocate");
    return out;
  };

  const medal = (i: number) => (i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}`);

  return (
    <div className="space-y-6 max-w-7xl">
      <div>
        <h1 className="page-title">
          <Radar className="size-6 text-emerald-600" /> Referral Radar
        </h1>
        <p className="page-subtitle">
          Referrals are the #1 growth channel for MFDs — this is your ask-worklist: who to ask right now,
          and who already sends you business.
        </p>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat icon={Users} label="Referral leads (all-time)" value={String(totalReferrals)} />
        <Stat icon={TrendingUp} label="Converted" value={String(convertedReferrals)} tone="emerald" />
        <Stat icon={Percent} label="Conversion" value={conversionPct == null ? "—" : `${conversionPct}%`} tone="emerald" />
        <Stat icon={CalendarClock} label="Referrals last 90d" value={String(last90)} />
      </div>

      {/* ── 1. Likely referrers ─────────────────────────────────────────────── */}
      <div className="card-surface overflow-hidden">
        <div className="px-4 py-3 border-b bg-secondary/30">
          <h2 className="font-semibold text-sm flex items-center gap-2">
            <Radar className="size-4 text-emerald-600" /> Clients most likely to refer right now
          </h2>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Scored on active SIPs (+2), AUM at/above the firm median (+1), tenure ≥ 1 year (+1), referred
            before (+1). Clients asked in the last 90 days are hidden.
          </p>
        </div>
        {data.likely.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            <Radar className="size-8 mx-auto text-muted-foreground/50" />
            <div className="mt-2 font-medium">No likely referrers to surface right now.</div>
            <p className="mt-2 text-xs max-w-md mx-auto">
              This list fills up as clients build tenure, run active SIPs and grow AUM — or drains while
              recent “Referral ask” tasks are still open (asked clients are hidden for 90 days).
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Client</th>
                <th className="text-right py-2 font-medium">AUM</th>
                <th className="text-right py-2 font-medium">Active SIPs</th>
                <th className="text-right py-2 font-medium">Tenure</th>
                <th className="text-left py-2 pl-4 font-medium">Referred before</th>
                <th className="text-right py-2 font-medium">Score</th>
                <th className="text-right px-4 py-2 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {data.likely.map((r) => {
                const yrs = tenureYears(r.created_at);
                return (
                  <tr key={r.id} className="border-b last:border-0 hover:bg-secondary/40 align-middle">
                    <td className="px-4 py-2.5">
                      <Link href={`/dashboard/investors/${r.id}`} className="font-medium hover:underline">
                        {r.name}
                      </Link>
                      <div className="text-[10px] text-muted-foreground">
                        {r.rm_id ? data.rmMap.get(r.rm_id) ?? "—" : "—"}
                      </div>
                    </td>
                    <td className="py-2.5 text-right tabular-nums">
                      {Number(r.aum) > 0 ? formatINR(Number(r.aum)) : "—"}
                    </td>
                    <td className="py-2.5 text-right tabular-nums">{r.active_sips}</td>
                    <td className="py-2.5 text-right tabular-nums">{yrs.toFixed(1)} yrs</td>
                    <td className="py-2.5 pl-4">
                      {r.referred_before ? (
                        <span className="chip border bg-emerald-50 text-emerald-700 border-emerald-200 text-[11px]">
                          Proven advocate
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="py-2.5 text-right">
                      <span className="inline-flex items-center justify-center min-w-7 px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-xs font-bold tabular-nums">
                        {r.score}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <ReferralAskButton
                        investorId={r.id}
                        investorName={r.name}
                        rmId={r.rm_id}
                        signals={signalsFor(r)}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── 2. Referral leaderboard ─────────────────────────────────────────── */}
      <div className="card-surface overflow-hidden">
        <div className="px-4 py-3 border-b bg-secondary/30">
          <h2 className="font-semibold text-sm flex items-center gap-2">
            <Trophy className="size-4 text-amber-500" /> Referral leaderboard
          </h2>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Clients who already sent business — thank them, and keep the flywheel spinning.
          </p>
        </div>
        {data.leaders.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            <Trophy className="size-8 mx-auto text-muted-foreground/50" />
            <div className="mt-2 font-medium">No referrals recorded yet.</div>
            <p className="mt-2 text-xs max-w-md mx-auto">
              When you add a lead, pick source “Referral” or “Existing client” and choose the referring
              client — every lead tagged that way builds this leaderboard automatically.
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b">
              <tr>
                <th className="text-left px-4 py-2 font-medium w-12">#</th>
                <th className="text-left py-2 font-medium">Client</th>
                <th className="text-right py-2 font-medium">Referrals given</th>
                <th className="text-right py-2 font-medium">Converted</th>
                <th className="text-right py-2 font-medium">Latest referral</th>
                <th className="text-right px-4 py-2 font-medium">
                  <span className="inline-flex items-center gap-1">
                    <Gift className="size-3" /> Appreciation given
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.leaders.map((r, i) => (
                <tr key={r.investor_id} className="border-b last:border-0 hover:bg-secondary/40">
                  <td className="px-4 py-2.5 text-base">{medal(i)}</td>
                  <td className="py-2.5">
                    {r.name ? (
                      <Link href={`/dashboard/investors/${r.investor_id}`} className="font-medium hover:underline">
                        {r.name}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">Former client</span>
                    )}
                  </td>
                  <td className="py-2.5 text-right tabular-nums font-semibold">{r.referrals_given}</td>
                  <td className="py-2.5 text-right tabular-nums">
                    {r.converted > 0 ? (
                      <span className="text-emerald-600 font-medium">{r.converted}</span>
                    ) : (
                      "0"
                    )}
                  </td>
                  <td className="py-2.5 text-right text-xs text-muted-foreground">
                    {formatDate(r.latest_referral)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {Number(r.gift_total) > 0 ? formatINR(Number(r.gift_total)) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground italic">
        The “Ask for referral” button creates a follow-up task for the client's RM with the happy-client
        signals attached — the client then disappears from this list for 90 days so nobody is over-asked.
      </p>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: any;
  label: string;
  value: string;
  tone?: "emerald";
}) {
  return (
    <div className="kpi-card">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">{label}</span>
        <Icon className="size-3.5 text-muted-foreground" />
      </div>
      <div className={`text-2xl font-bold mt-1 tabular-nums ${tone === "emerald" ? "text-emerald-600" : "text-foreground"}`}>
        {value}
      </div>
    </div>
  );
}
