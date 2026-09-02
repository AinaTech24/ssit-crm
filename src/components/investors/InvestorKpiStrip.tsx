import { sql } from "drizzle-orm";
import {
  Users,
  IndianRupee,
  TrendingUp,
  ShieldCheck,
  AlertTriangle,
  CalendarCheck,
  UserMinus,
  Crown,
} from "lucide-react";
import { withTenant } from "@/db/client";
import { formatINR } from "@/lib/utils";
import type { SessionUser } from "@/lib/auth/session";

/**
 * KPI strip for the Investors list page.
 *
 * Replaces the old "N investors" subtitle line with a glanceable row of
 * 8 tiles owners + RMs actually look at every day.
 *
 * Single SQL roundtrip — all eight counts/sums in one query.
 */
export async function InvestorKpiStrip({
  session,
}: {
  session: SessionUser;
}) {
  const data = await withTenant(
    session.tenantId,
    async (tx) => {
      const r = await tx.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE status = 'active')::int AS total_active,
          COUNT(*)::int AS total_all,
          COALESCE(SUM(aum::numeric) FILTER (WHERE status = 'active'), 0)::numeric AS total_aum,
          COALESCE(SUM(active_sip_amount::numeric) FILTER (WHERE status = 'active'), 0)::numeric AS sip_book,
          COUNT(*) FILTER (WHERE status = 'active' AND service_tier = 'A')::int AS tier_a,
          COUNT(*) FILTER (
            WHERE status = 'active'
              AND next_review_at IS NOT NULL
              AND next_review_at <= now()
          )::int AS reviews_due,
          COUNT(*) FILTER (
            WHERE status = 'active'
              AND (
                kyc_status IN ('expired', 're_kyc_required')
                OR (ckyc_expiry_at IS NOT NULL
                    AND ckyc_expiry_at BETWEEN current_date AND current_date + interval '30 days')
              )
          )::int AS kyc_expiring,
          COUNT(*) FILTER (
            WHERE status = 'active' AND (nominee_name IS NULL OR nominee_name = '')
          )::int AS nominee_missing,
          COUNT(*) FILTER (
            WHERE status = 'active'
              AND (last_transaction_at IS NULL OR last_transaction_at < now() - make_interval(days => COALESCE((SELECT dormancy_window_days FROM tenants WHERE id = investors.tenant_id), 180)))
          )::int AS dormant
        FROM investors
        -- Trashed (soft-deleted) clients must NOT inflate the counts/AUM — the
        -- list excludes them (deleted_at IS NULL), so the KPI strip must match,
        -- otherwise an emptied book still shows the old totals.
        WHERE deleted_at IS NULL
      `);
      return r.rows[0] as any;
    },
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );

  const totalActive = Number(data.total_active);
  const tierAPct = totalActive > 0 ? (Number(data.tier_a) / totalActive) * 100 : 0;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi
          label="Total clients"
          value={totalActive.toLocaleString("en-IN")}
          sub={`${Number(data.total_all).toLocaleString("en-IN")} all-time`}
          icon={Users}
          accent="cyan"
        />
        <Kpi
          label="Total AUM"
          value={formatINR(Number(data.total_aum))}
          sub="active clients"
          icon={IndianRupee}
          accent="emerald"
        />
        <Kpi
          label="Monthly SIP book"
          value={formatINR(Number(data.sip_book))}
          sub="active SIPs"
          icon={TrendingUp}
          accent="emerald"
        />
        <Kpi
          label="A-tier clients"
          value={`${Number(data.tier_a)} · ${tierAPct.toFixed(0)}%`}
          sub="quarterly review cadence"
          icon={Crown}
          accent="violet"
        />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi
          label="Reviews due"
          value={String(Number(data.reviews_due))}
          sub="schedule meetings"
          icon={CalendarCheck}
          accent={Number(data.reviews_due) > 0 ? "amber" : "muted"}
        />
        <Kpi
          label="KYC expiring 30d"
          value={String(Number(data.kyc_expiring))}
          sub="renew or refresh"
          icon={ShieldCheck}
          accent={Number(data.kyc_expiring) > 0 ? "rose" : "muted"}
        />
        <Kpi
          label="Nominee missing"
          value={String(Number(data.nominee_missing))}
          sub="transmission risk"
          icon={AlertTriangle}
          accent={Number(data.nominee_missing) > 0 ? "amber" : "muted"}
        />
        <Kpi
          label="Dormant"
          value={String(Number(data.dormant))}
          sub="no tx in 180d"
          icon={UserMinus}
          accent={Number(data.dormant) > 0 ? "amber" : "muted"}
        />
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: any;
  accent: "cyan" | "violet" | "emerald" | "amber" | "rose" | "muted";
}) {
  const bg: Record<string, string> = {
    cyan: "bg-brand-cyan-light text-brand-cyan-deep",
    violet: "bg-violet-50 text-violet-600",
    emerald: "bg-emerald-50 text-emerald-600",
    amber: "bg-amber-50 text-amber-600",
    rose: "bg-rose-50 text-rose-600",
    muted: "bg-secondary text-muted-foreground",
  };
  const valueColor =
    accent === "rose"
      ? "text-rose-700"
      : accent === "amber"
      ? "text-amber-700"
      : "text-foreground";
  return (
    <div className="card-surface glass-card p-4">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
          {label}
        </span>
        <div className={`size-8 rounded-lg grid place-items-center ${bg[accent]}`}>
          <Icon className="size-4" />
        </div>
      </div>
      <div className={`text-xl font-bold mt-2 tabular-nums tracking-tight ${valueColor}`}>
        {value}
      </div>
      {sub && <div className="text-[11px] text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}
