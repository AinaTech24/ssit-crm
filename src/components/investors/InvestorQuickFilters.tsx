import Link from "next/link";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import type { SessionUser } from "@/lib/auth/session";

/**
 * Quick-filter chip strip for the Investors list page.
 *
 * Each chip is a deep link to the same /dashboard/investors page with the
 * appropriate query params set — list-page conditions consume the same flag
 * names. Counts are fetched server-side in a single roundtrip.
 *
 * Filter keys consumed by the list page:
 *   - mine=1              → rm_id = session.userId
 *   - tier_a=1            → service_tier = 'A'
 *   - reviews_due=1       → next_review_at <= now()
 *   - kyc_expiring=1      → ckyc_expiry < +30d OR kyc_status in (expired/re_kyc)
 *   - no_nominee=1        → nominee_name IS NULL/''
 *   - dormant=1           → last_transaction_at < -180d
 *   - rp_stale=1          → risk_profile_signed_at < -365d OR NULL
 *   - birthday_week=1     → dob (mm-dd) in next 7 days
 *   - hni=1               → segment_tag = 'HNI'
 */
export async function InvestorQuickFilters({
  session,
  active,
}: {
  session: SessionUser;
  active: Record<string, string | undefined>;
}) {
  const userId = session.userId;
  const counts = await withTenant(
    session.tenantId,
    async (tx) => {
      const r = await tx.execute(sql`
        SELECT
          COUNT(*) FILTER (
            WHERE rm_id = ${userId} AND status = 'active'
          )::int AS mine,
          COUNT(*) FILTER (
            WHERE status = 'active' AND service_tier = 'A'
          )::int AS tier_a,
          COUNT(*) FILTER (
            WHERE status = 'active' AND next_review_at IS NOT NULL AND next_review_at <= now()
          )::int AS reviews_due,
          COUNT(*) FILTER (
            WHERE status = 'active' AND (
              kyc_status IN ('expired','re_kyc_required')
              OR (ckyc_expiry_at IS NOT NULL
                  AND ckyc_expiry_at BETWEEN current_date AND current_date + interval '30 days')
            )
          )::int AS kyc_expiring,
          COUNT(*) FILTER (
            WHERE status = 'active' AND (nominee_name IS NULL OR nominee_name = '')
          )::int AS no_nominee,
          COUNT(*) FILTER (
            WHERE status = 'active'
              AND (last_transaction_at IS NULL OR last_transaction_at < now() - make_interval(days => COALESCE((SELECT dormancy_window_days FROM tenants WHERE id = investors.tenant_id), 180)))
          )::int AS dormant,
          COUNT(*) FILTER (
            WHERE status = 'active'
              AND (risk_profile_signed_at IS NULL OR risk_profile_signed_at < now() - interval '365 days')
          )::int AS rp_stale,
          COUNT(*) FILTER (
            WHERE status = 'active' AND dob IS NOT NULL
              AND to_char(dob, 'MM-DD') BETWEEN to_char(current_date, 'MM-DD')
                                            AND to_char(current_date + interval '7 days', 'MM-DD')
          )::int AS birthday_week,
          COUNT(*) FILTER (
            WHERE status = 'active' AND dob IS NOT NULL
              AND to_char(dob, 'MM-DD') = to_char(current_date, 'MM-DD')
          )::int AS birthday_today,
          COUNT(*) FILTER (
            WHERE status = 'active' AND segment_tag = 'HNI'
          )::int AS hni,
          COUNT(*) FILTER (
            WHERE status = 'active' AND cross_sell IS NOT NULL AND EXISTS (
              SELECT 1 FROM jsonb_each_text(cross_sell) AS cs(k, v)
              WHERE cs.v IN ('held_elsewhere', 'interested', 'not_held')
            )
          )::int AS cross_sell_opp
        FROM investors
        WHERE deleted_at IS NULL
      `);
      return r.rows[0] as any;
    },
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );

  const chips: Array<{ key: string; label: string; count: number; tone: string }> = [
    { key: "birthday_today", label: "🎂 Today's birthday", count: Number(counts.birthday_today), tone: "emerald" },
    { key: "mine", label: "My clients", count: Number(counts.mine), tone: "violet" },
    { key: "tier_a", label: "A-tier", count: Number(counts.tier_a), tone: "violet" },
    { key: "hni", label: "HNI", count: Number(counts.hni), tone: "violet" },
    { key: "reviews_due", label: "Reviews due", count: Number(counts.reviews_due), tone: "amber" },
    { key: "kyc_expiring", label: "KYC expiring 30d", count: Number(counts.kyc_expiring), tone: "rose" },
    { key: "no_nominee", label: "No nominee", count: Number(counts.no_nominee), tone: "amber" },
    { key: "rp_stale", label: "Risk profile stale", count: Number(counts.rp_stale), tone: "amber" },
    { key: "dormant", label: "Dormant", count: Number(counts.dormant), tone: "amber" },
    { key: "birthday_week", label: "🎂 Birthday week", count: Number(counts.birthday_week), tone: "emerald" },
    { key: "cross_sell_opp", label: "↗ Cross-sell opportunity", count: Number(counts.cross_sell_opp), tone: "violet" },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mr-1">
        Quick filters:
      </span>
      {chips.map((c) => {
        const isActive = active[c.key] === "1";
        const next = new URLSearchParams();
        for (const [k, v] of Object.entries(active)) {
          // Toggling a quick filter resets paging (drop any carried `page`).
          if (v && k !== c.key && k !== "page") next.set(k, v);
        }
        if (!isActive) next.set(c.key, "1");
        const href = `/dashboard/investors${next.toString() ? `?${next.toString()}` : ""}`;
        const cls = toneClass(c.tone, isActive);
        return (
          <Link
            key={c.key}
            href={href}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border transition-all ${cls}`}
          >
            <span className="font-medium">{c.label}</span>
            <span className="tabular-nums font-bold opacity-90">{c.count}</span>
          </Link>
        );
      })}
    </div>
  );
}

function toneClass(tone: string, active: boolean): string {
  const base: Record<string, string> = {
    violet: active
      ? "bg-violet-600 text-white border-violet-600 shadow-sm"
      : "bg-violet-50 text-violet-700 border-violet-200 hover:bg-violet-100",
    amber: active
      ? "bg-amber-600 text-white border-amber-600 shadow-sm"
      : "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100",
    rose: active
      ? "bg-rose-600 text-white border-rose-600 shadow-sm"
      : "bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100",
    emerald: active
      ? "bg-emerald-600 text-white border-emerald-600 shadow-sm"
      : "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100",
  };
  return base[tone] ?? base.violet;
}
