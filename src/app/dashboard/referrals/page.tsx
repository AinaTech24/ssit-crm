import Link from "next/link";
import { sql } from "drizzle-orm";
import { Users, TrendingUp, Heart, CheckCircle2 } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
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
  // Every query below is firm-wide — there is no per-RM scoping — so this needs
  // the firm-wide client capability. It matters now that the page is reachable
  // from the sidebar: an RM opening it would otherwise see colleagues' books.
  requireAny(session.roles, ["investor.view.all"], session.permissions);
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
    // ── Breakdowns ──────────────────────────────────────────────────────
    // Credited to the REFERRING CLIENT'S RM, not the lead's owner: the referral
    // came out of that relationship, and the lead may be routed to anyone
    // afterwards. Branch follows the same RM, which is the only branch link a
    // lead has.
    const byRm = await tx.execute(sql`
      SELECT u.id, COALESCE(u.name, 'Unassigned') AS name,
             COUNT(l.id)::int AS referrals,
             COUNT(DISTINCT i.id)::int AS referrers,
             COUNT(l.id) FILTER (WHERE l.converted_investor_id IS NOT NULL OR l.stage = 'converted')::int AS converted
        FROM leads l
        JOIN investors i ON i.id = l.referred_by_investor_id AND i.tenant_id = l.tenant_id
        LEFT JOIN users u ON u.id = i.rm_id
       WHERE i.deleted_at IS NULL
       GROUP BY u.id, u.name
       ORDER BY referrals DESC
    `);

    const byBranch = await tx.execute(sql`
      SELECT br.id, COALESCE(br.name, 'Unassigned') AS name,
             COUNT(l.id)::int AS referrals,
             COUNT(l.id) FILTER (WHERE l.converted_investor_id IS NOT NULL OR l.stage = 'converted')::int AS converted
        FROM leads l
        JOIN investors i ON i.id = l.referred_by_investor_id AND i.tenant_id = l.tenant_id
        LEFT JOIN users u ON u.id = i.rm_id
        LEFT JOIN branches br ON br.id = u.branch_id
       WHERE i.deleted_at IS NULL
       GROUP BY br.id, br.name
       ORDER BY referrals DESC
    `);

    // Products the referred lead asked about. A lead can name several, so the
    // array is unnested — the counts therefore sum to MORE than the referral
    // total, which is correct and worth saying on the card.
    const byProduct = await tx.execute(sql`
      SELECT p.product AS name, COUNT(*)::int AS referrals
        FROM leads l
        JOIN investors i ON i.id = l.referred_by_investor_id AND i.tenant_id = l.tenant_id
        CROSS JOIN LATERAL jsonb_array_elements_text(
          CASE WHEN jsonb_typeof(l.interest_products) = 'array'
               THEN l.interest_products ELSE '[]'::jsonb END
        ) AS p(product)
       WHERE i.deleted_at IS NULL
       GROUP BY p.product
       ORDER BY referrals DESC
    `);

    // Business actually booked for clients who came in as a referral — the
    // question "was any of this worth it". Counts booked entries, not AUM.
    const business = await tx.execute(sql`
      SELECT COALESCE(SUM(e.total_amount::numeric), 0)::numeric AS total,
             COUNT(DISTINCT e.id)::int AS entries,
             COUNT(DISTINCT e.investor_id)::int AS clients
        FROM business_entries e
       WHERE e.status <> 'cancelled'
         AND e.investor_id IN (
           SELECT l.converted_investor_id FROM leads l
            WHERE l.referred_by_investor_id IS NOT NULL
              AND l.converted_investor_id IS NOT NULL
         )
    `);

    return {
      rows: rows.rows as any[],
      summary: summary.rows[0] as any,
      byRm: byRm.rows as any[],
      byBranch: byBranch.rows as any[],
      byProduct: byProduct.rows as any[],
      business: (business.rows[0] as any) ?? { total: 0, entries: 0, clients: 0 },
    };
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

      {/* Each tile drills into the list that produced the number — a count you
          cannot open is a number you have to go and re-derive by hand. */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Stat
          icon={Users}
          label="Active referrers"
          value={String(data.summary?.active_referrers ?? 0)}
          href="#referrers"
        />
        <Stat
          icon={Heart}
          label="Total referrals received"
          value={String(data.summary?.total_referrals ?? 0)}
          href="/dashboard/leads?referred=1"
        />
        <Stat
          icon={CheckCircle2}
          label="Converted"
          value={String(data.summary?.total_converted ?? 0)}
          tone="emerald"
          href="/dashboard/leads?referred=1&stage=converted"
        />
        <Stat
          icon={TrendingUp}
          label="Business generated"
          value={Number(data.business?.total) > 0 ? formatINR(Number(data.business.total)) : "—"}
          sub={`${Number(data.business?.entries ?? 0)} entries · ${Number(data.business?.clients ?? 0)} clients`}
          tone="emerald"
          href="/dashboard/business-entries"
        />
        <Stat
          icon={TrendingUp}
          label="Converted AUM"
          value={data.summary?.converted_aum ? formatINR(Number(data.summary.converted_aum)) : "—"}
          tone="emerald"
          href="/dashboard/investors"
        />
      </div>

      {/* RM / branch / product splits. Every row opens the leads it counts. */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card-surface p-4">
          <h2 className="text-sm font-semibold mb-2">RM-wise referrals</h2>
          <SplitTable
            rows={data.byRm.map((r: any) => ({
              key: r.id,
              name: r.name,
              count: Number(r.referrals),
              extra: `${Number(r.converted)} converted`,
              href: r.id ? `/dashboard/leads?referred=1&referrerRm=${r.id}` : "/dashboard/leads?referred=1",
            }))}
          />
          <p className="text-[11px] text-muted-foreground mt-2">
            Credited to the referring client&apos;s RM — the referral came out of that relationship,
            wherever the lead was routed afterwards.
          </p>
        </div>

        <div className="card-surface p-4">
          <h2 className="text-sm font-semibold mb-2">Branch-wise referrals</h2>
          <SplitTable
            rows={data.byBranch.map((r: any) => ({
              key: r.id,
              name: r.name,
              count: Number(r.referrals),
              extra: `${Number(r.converted)} converted`,
              href: r.id
                ? `/dashboard/leads?referred=1&referrerBranch=${r.id}`
                : "/dashboard/leads?referred=1",
            }))}
          />
        </div>

        <div className="card-surface p-4">
          <h2 className="text-sm font-semibold mb-2">Product-wise referrals</h2>
          <SplitTable
            rows={data.byProduct.map((r: any) => ({
              key: r.name,
              name: r.name,
              count: Number(r.referrals),
              href: `/dashboard/leads?referred=1&product=${encodeURIComponent(r.name)}`,
            }))}
          />
          <p className="text-[11px] text-muted-foreground mt-2">
            A lead can name several products, so these sum to more than the referral total.
          </p>
        </div>
      </div>

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

      <div id="referrers" className="card-surface overflow-hidden scroll-mt-24">
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

function Stat({
  icon: Icon,
  label,
  value,
  sub,
  tone,
  href,
}: {
  icon: any;
  label: string;
  value: string;
  sub?: string;
  tone?: "emerald";
  href?: string;
}) {
  const body = (
    <>
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
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
    </>
  );
  if (!href) return <div className="kpi-card">{body}</div>;
  return (
    <Link
      href={href}
      className="kpi-card block cursor-pointer transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-cyan/40"
    >
      {body}
    </Link>
  );
}

/** A breakdown list where every row opens the leads behind it. */
function SplitTable({
  rows,
}: {
  rows: Array<{ key: string | null; name: string; count: number; extra?: string; href: string }>;
}) {
  if (rows.length === 0) {
    return <div className="text-xs text-muted-foreground py-6 text-center">No referrals yet.</div>;
  }
  const max = Math.max(...rows.map((r) => r.count), 1);
  return (
    <table className="w-full text-sm">
      <thead className="text-[11px] text-muted-foreground border-b">
        <tr>
          <th className="text-left py-1.5 font-medium">Name</th>
          <th className="text-right py-1.5 font-medium">Referrals</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.key ?? `_${i}`} className="border-b last:border-0 hover:bg-accent/50">
            <td className="py-2 pr-2">
              <Link href={r.href} className="font-medium hover:underline block truncate max-w-[12rem]">
                {r.name}
              </Link>
              <div className="mt-1 h-1 w-full rounded-full bg-secondary overflow-hidden">
                <div className="h-full bg-brand-cyan" style={{ width: `${Math.round((r.count / max) * 100)}%` }} />
              </div>
              {r.extra && <div className="text-[10px] text-muted-foreground mt-0.5">{r.extra}</div>}
            </td>
            <td className="py-2 text-right tabular-nums font-semibold align-top">{r.count}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
