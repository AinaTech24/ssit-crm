import { sql } from "drizzle-orm";
import {
  Users2,
  IndianRupee,
  TrendingUp,
  UserCog,
  Crown,
  ShieldCheck,
  CalendarCheck,
  AlertTriangle,
} from "lucide-react";
import { withTenant } from "@/db/client";
import { formatINR } from "@/lib/utils";
import type { SessionUser } from "@/lib/auth/session";

/**
 * KPI strip for the Families list page.
 *
 * Single SQL roundtrip — eight family-level facts an MFD owner asks about
 * every Monday: how big is my book of families, how exposed am I, what's
 * unfinished?
 */
export async function FamilyKpiStrip({ session }: { session: SessionUser }) {
  const data = await withTenant(
    session.tenantId,
    async (tx) => {
      const r = await tx.execute(sql`
        WITH fam AS (
          SELECT
            f.id, f.primary_investor_id, f.rm_id, f.last_review_at, f.next_review_at,
            COUNT(i.id) FILTER (WHERE i.status = 'active') AS active_members,
            COUNT(i.id) FILTER (WHERE i.status = 'active'
              AND (i.nominee_name IS NULL OR i.nominee_name = '')) AS nominee_gap,
            COALESCE(SUM(i.aum::numeric) FILTER (WHERE i.status = 'active'), 0) AS family_aum,
            COALESCE(SUM(i.active_sip_amount::numeric) FILTER (WHERE i.status = 'active'), 0) AS family_sip,
            MAX(i.segment_tag) FILTER (WHERE i.segment_tag = 'HNI') AS has_hni
          FROM families f
          LEFT JOIN investors i ON i.family_id = f.id
          GROUP BY f.id
        )
        SELECT
          COUNT(*)::int AS total_families,
          COALESCE(SUM(family_aum), 0)::numeric AS combined_aum,
          COALESCE(SUM(family_sip), 0)::numeric AS combined_sip,
          COALESCE(AVG(active_members), 0)::numeric AS avg_members,
          COUNT(*) FILTER (WHERE primary_investor_id IS NULL)::int AS no_primary,
          COUNT(*) FILTER (WHERE rm_id IS NULL)::int AS no_rm,
          COUNT(*) FILTER (
            WHERE next_review_at IS NULL OR next_review_at <= now()
          )::int AS review_due,
          COUNT(*) FILTER (WHERE nominee_gap > 0)::int AS nominee_gap_families,
          COUNT(*) FILTER (WHERE has_hni = 'HNI')::int AS hni_families
        FROM fam
      `);
      return r.rows[0] as any;
    },
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi
          label="Total families"
          value={Number(data.total_families).toLocaleString("en-IN")}
          sub={`avg ${Number(data.avg_members).toFixed(1)} members`}
          icon={Users2}
          accent="cyan"
        />
        <Kpi
          label="Combined AUM"
          value={formatINR(Number(data.combined_aum))}
          sub="active members"
          icon={IndianRupee}
          accent="emerald"
        />
        <Kpi
          label="Monthly SIP book"
          value={formatINR(Number(data.combined_sip))}
          sub="family-wide"
          icon={TrendingUp}
          accent="emerald"
        />
        <Kpi
          label="HNI families"
          value={String(Number(data.hni_families))}
          sub="at least one HNI member"
          icon={Crown}
          accent="violet"
        />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi
          label="No primary set"
          value={String(Number(data.no_primary))}
          sub="ambiguous head"
          icon={Crown}
          accent={Number(data.no_primary) > 0 ? "amber" : "muted"}
        />
        <Kpi
          label="No family RM"
          value={String(Number(data.no_rm))}
          sub="assign one"
          icon={UserCog}
          accent={Number(data.no_rm) > 0 ? "amber" : "muted"}
        />
        <Kpi
          label="Nominee gap"
          value={String(Number(data.nominee_gap_families))}
          sub="families with ≥1 gap"
          icon={ShieldCheck}
          accent={Number(data.nominee_gap_families) > 0 ? "rose" : "muted"}
        />
        <Kpi
          label="Review due"
          value={String(Number(data.review_due))}
          sub="schedule today"
          icon={CalendarCheck}
          accent={Number(data.review_due) > 0 ? "amber" : "muted"}
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
