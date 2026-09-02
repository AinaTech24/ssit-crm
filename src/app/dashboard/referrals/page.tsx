import Link from "next/link";
import { sql } from "drizzle-orm";
import { Users, TrendingUp, Heart, CheckCircle2, Clock, Sparkles, Phone } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { formatINR, formatDate } from "@/lib/utils";
import { CompactFilterBar } from "@/components/common/CompactFilterBar";
import { CustomViews } from "@/components/common/CustomViews";

export const dynamic = "force-dynamic";

export default async function ReferralsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const minOnly = sp.min === "2";

  const data = await withTenant(session.tenantId, async (tx) => {
    // Aggregate referrals per existing investor.
    const conds: any[] = [sql`i.deleted_at IS NULL`];
    if (q) conds.push(sql`i.name ILIKE ${`%${q}%`}`);
    const whereSql = conds.length ? sql` WHERE ${sql.join(conds, sql` AND `)}` : sql``;
    const minSql = minOnly ? sql` HAVING COUNT(l.id) >= 2 ` : sql``;

    const rows = await tx.execute(sql`
      SELECT
        i.id AS referrer_id,
        i.name AS referrer_name,
        i.phone AS referrer_phone,
        i.email AS referrer_email,
        i.segment_tag,
        i.service_tier,
        COUNT(l.id)::int AS leads_given,
        COUNT(l.id) FILTER (WHERE l.converted_investor_id IS NOT NULL)::int AS converted,
        COUNT(l.id) FILTER (
          WHERE l.converted_investor_id IS NULL AND l.stage NOT IN ('lost','not_interested')
        )::int AS in_pipeline,
        COUNT(l.id) FILTER (
          WHERE l.stage IN ('lost','not_interested')
        )::int AS lost,
        COALESCE(SUM(inv.aum::numeric), 0)::numeric AS converted_aum
      FROM investors i
      JOIN leads l ON l.referred_by_investor_id = i.id
      LEFT JOIN investors inv ON inv.id = l.converted_investor_id
      ${whereSql}
      GROUP BY i.id, i.name, i.phone, i.email, i.segment_tag, i.service_tier
      ${minSql}
      ORDER BY leads_given DESC, converted DESC
      LIMIT 200
    `);

    const summary = await tx.execute(sql`
      SELECT
        COUNT(DISTINCT i.id)::int AS active_referrers,
        COUNT(l.id)::int AS total_referrals,
        COUNT(l.id) FILTER (WHERE l.converted_investor_id IS NOT NULL)::int AS total_converted,
        ROUND(
          100.0 * COUNT(l.id) FILTER (WHERE l.converted_investor_id IS NOT NULL)
            / NULLIF(COUNT(l.id), 0), 1
        ) AS conversion_pct,
        COALESCE(SUM(inv.aum::numeric), 0)::numeric AS converted_aum
      FROM investors i
      JOIN leads l ON l.referred_by_investor_id = i.id
      LEFT JOIN investors inv ON inv.id = l.converted_investor_id
      WHERE i.deleted_at IS NULL
    `);
    // Advocates to ask — your best clients who have NEVER referred anyone.
    // High AUM + active + not flagged redemption-risk = happy, sticky, untapped.
    // This is the proactive growth half of a referral engine: don't just track
    // who referred, surface who SHOULD be asked.
    const advocates = await tx.execute(sql`
      SELECT i.id, i.name, i.phone, COALESCE(i.aum, 0)::numeric AS aum, i.service_tier, i.last_contact_at
      FROM investors i
      LEFT JOIN leads l ON l.referred_by_investor_id = i.id
      WHERE i.status = 'active'
        AND i.deleted_at IS NULL
        AND i.redemption_risk_flagged_at IS NULL
      GROUP BY i.id, i.name, i.phone, i.aum, i.service_tier, i.last_contact_at
      HAVING COUNT(l.id) = 0
      ORDER BY i.aum DESC NULLS LAST
      LIMIT 8
    `);

    return { rows: rows.rows as any[], summary: summary.rows[0] as any, advocates: advocates.rows as any[] };
  });

  return (
    <div className="space-y-6 max-w-7xl">
      <div>
        <h1 className="page-title">
          <Heart className="size-6 text-brand-cyan" /> Referral Tracking
        </h1>
        <p className="page-subtitle">
          Which clients are referring new business — and how much of it converts. Use this list to schedule
          thank-you calls and identify your top advocates.
        </p>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <Stat
          icon={Users}
          label="Active referrers"
          value={String(data.summary?.active_referrers ?? 0)}
        />
        <Stat
          icon={Heart}
          label="Total referrals"
          value={String(data.summary?.total_referrals ?? 0)}
        />
        <Stat
          icon={CheckCircle2}
          label="Converted"
          value={String(data.summary?.total_converted ?? 0)}
          tone="emerald"
        />
        <Stat
          icon={TrendingUp}
          label="Converted AUM"
          value={data.summary?.converted_aum ? formatINR(Number(data.summary.converted_aum)) : "—"}
          tone="emerald"
        />
      </div>

      {/* Advocates to ask — proactive referral generation */}
      {data.advocates.length > 0 && (
        <div className="card-surface p-5">
          <div className="flex items-center gap-2 mb-1">
            <Sparkles className="size-5 text-brand-cyan" />
            <h2 className="font-semibold">Advocates to ask this week</h2>
          </div>
          <p className="text-xs text-muted-foreground mb-4 max-w-2xl">
            Your highest-value, sticky clients who have never referred anyone. They&apos;re happy and
            engaged — a warm, no-pressure ask is the cheapest growth you have. Aim for one referral
            conversation a week.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {data.advocates.map((a) => (
              <div key={a.id} className="flex items-center gap-3 rounded-lg border bg-card p-3">
                <div className="size-9 rounded-full brand-gradient text-white grid place-items-center text-xs font-bold shrink-0">
                  {a.name?.split(" ").map((n: string) => n[0]).slice(0, 2).join("").toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <Link href={`/dashboard/investors/${a.id}`} className="font-medium text-sm hover:underline truncate block">
                    {a.name}
                  </Link>
                  <div className="text-[11px] text-muted-foreground">
                    {Number(a.aum) > 0 ? formatINR(Number(a.aum)) : "—"}
                    {a.service_tier ? ` · Tier ${a.service_tier}` : ""}
                  </div>
                </div>
                {a.phone && (
                  <a href={`tel:${a.phone}`} className="btn-secondary text-xs shrink-0" title="Call to ask for a referral">
                    <Phone className="size-3.5" /> Ask
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <CompactFilterBar
        totalCount={data.rows.length}
        filters={[
          { type: "search", key: "q", placeholder: "Search by referrer name…" },
        ]}
        rightSlot={
          <CustomViews
            viewsKey="views:referrals"
            presets={[
              { id: "top", name: "Top referrers (2+)", params: "min=2" },
            ]}
          />
        }
      />

      <div className="card-surface overflow-hidden">
        {data.rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            <Heart className="size-8 mx-auto text-muted-foreground/50" />
            <div className="mt-2 font-medium">No referrals yet.</div>
            <p className="mt-2 text-xs max-w-md mx-auto">
              When a lead's source is "Client Referral" and the referrer is linked, they appear here. Encourage
              your top clients to refer family + friends.
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Referrer</th>
                <th className="text-left py-2 font-medium">Segment / Tier</th>
                <th className="text-right py-2 font-medium">Leads given</th>
                <th className="text-right py-2 font-medium">Converted</th>
                <th className="text-right py-2 font-medium">In pipeline</th>
                <th className="text-right py-2 font-medium">Lost</th>
                <th className="text-right py-2 font-medium">Business AUM</th>
                <th className="text-right py-2 font-medium">Conv %</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => {
                const convPct = r.leads_given > 0 ? Math.round((r.converted / r.leads_given) * 100) : 0;
                return (
                  <tr key={r.referrer_id} className="border-b last:border-0 hover:bg-secondary/40">
                    <td className="px-4 py-3">
                      <Link href={`/dashboard/investors/${r.referrer_id}`} className="font-medium hover:underline">
                        {r.referrer_name}
                      </Link>
                      <div className="text-[10px] text-muted-foreground">{r.referrer_phone ?? "—"}</div>
                    </td>
                    <td className="py-3 text-xs">
                      {r.segment_tag ? <span className="chip bg-violet-50 text-violet-700 mr-1">{r.segment_tag}</span> : null}
                      {r.service_tier ? <span className="chip bg-secondary">Tier {r.service_tier}</span> : null}
                    </td>
                    <td className="py-3 text-right tabular-nums font-semibold">{r.leads_given}</td>
                    <td className="py-3 text-right tabular-nums text-emerald-700 font-semibold">{r.converted}</td>
                    <td className="py-3 text-right tabular-nums">{r.in_pipeline}</td>
                    <td className="py-3 text-right tabular-nums text-rose-700">{r.lost}</td>
                    <td className="py-3 text-right tabular-nums text-muted-foreground">
                      {Number(r.converted_aum) > 0 ? formatINR(Number(r.converted_aum)) : "—"}
                    </td>
                    <td className="py-3 text-right">
                      <span
                        className={`chip ${
                          convPct >= 50
                            ? "bg-emerald-50 text-emerald-700"
                            : convPct >= 20
                              ? "bg-amber-50 text-amber-700"
                              : "bg-gray-50 text-gray-700"
                        }`}
                      >
                        {convPct}%
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground italic">
        Per SEBI MFD guidelines, do not run a paid gift / incentive program for referrals without prior compliance
        approval. This page is for tracking and recognition only.
      </p>
    </div>
  );
}

function Stat({ icon: Icon, label, value, tone }: { icon: any; label: string; value: string; tone?: "emerald" }) {
  return (
    <div className="kpi-card">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">{label}</span>
        <Icon className="size-3.5 text-muted-foreground" />
      </div>
      <div
        className={`text-2xl font-bold mt-1 tabular-nums ${
          tone === "emerald" ? "text-emerald-600" : "text-foreground"
        }`}
      >
        {value}
      </div>
    </div>
  );
}
