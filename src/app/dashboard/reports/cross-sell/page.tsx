/**
 * Cross-sell opportunities report — the firm-wide wallet-share worklist.
 *
 * Turns the per-client holdings matrix (investors.crossSell) into a growth
 * view: how many clients are an opportunity for each product (held elsewhere /
 * interested / not held), and which clients have the most open opportunities.
 * Work it top-down to deepen the book.
 */

import Link from "next/link";
import { sql } from "drizzle-orm";
import { TrendingUp, ArrowRight, Users } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny, can } from "@/lib/auth/rbac";
import { users } from "@/db/schema";
import { formatINR } from "@/lib/utils";
import {
  CROSS_SELL_PRODUCTS,
  crossSellOpportunities,
  crossSellStatusLabel,
  crossSellStatusTone,
} from "@/lib/investors/cross-sell";

export const dynamic = "force-dynamic";

function inrCompact(n: number): string {
  if (!n || n <= 0) return "₹0";
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`;
  if (n >= 1e3) return `₹${(n / 1e3).toFixed(1)}K`;
  return `₹${Math.round(n)}`;
}

export default async function CrossSellReportPage() {
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
  const scope = seesAll ? sql` AND deleted_at IS NULL` : sql` AND deleted_at IS NULL AND rm_id = ${session.userId}::uuid`;

  const data = await withTenant(
    session.tenantId,
    async (tx) => {
      // Per-product opportunity counts + headline, in one pass.
      const productCols = CROSS_SELL_PRODUCTS.map(
        ([k]) =>
          sql`count(*) FILTER (WHERE cross_sell->>${k} IN ('held_elsewhere','interested','not_held'))::int AS ${sql.raw(k)}`
      );
      const summary = (
        await tx.execute(sql`
          SELECT
            count(*)::int AS total_active,
            count(*) FILTER (WHERE cross_sell IS NOT NULL AND EXISTS (
              SELECT 1 FROM jsonb_each_text(cross_sell) cs(k, v) WHERE cs.v IN ('held_elsewhere','interested','not_held')
            ))::int AS with_opp,
            COALESCE(SUM(aum) FILTER (WHERE cross_sell IS NOT NULL AND EXISTS (
              SELECT 1 FROM jsonb_each_text(cross_sell) cs(k, v) WHERE cs.v IN ('held_elsewhere','interested','not_held')
            )), 0)::numeric AS aum_with_opp
          FROM investors
          WHERE status = 'active'${scope}
        `)
      ).rows[0] as any;

      // Re-query with the dynamic product columns (kept separate so the
      // dynamic SELECT list is clean).
      const products = (
        await tx.execute(sql`
          SELECT ${sql.join(productCols, sql`, `)}
          FROM investors WHERE status = 'active'${scope}
        `)
      ).rows[0] as any;

      const top = await tx.execute(sql`
        SELECT id, name, aum, rm_id, cross_sell,
          (SELECT count(*) FROM jsonb_each_text(cross_sell) cs(k, v)
             WHERE cs.v IN ('held_elsewhere','interested','not_held'))::int AS opp_count
        FROM investors
        WHERE status = 'active'${scope}
          AND cross_sell IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM jsonb_each_text(cross_sell) cs(k, v) WHERE cs.v IN ('held_elsewhere','interested','not_held')
          )
        ORDER BY opp_count DESC, aum DESC NULLS LAST
        LIMIT 25
      `);

      const rmRows = await tx.select({ id: users.id, name: users.name }).from(users);
      const rmMap = new Map(rmRows.map((r) => [r.id, r.name]));

      return { summary, products, top: top.rows as any[], rmMap };
    },
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );

  const totalActive = Number(data.summary?.total_active ?? 0);
  const withOpp = Number(data.summary?.with_opp ?? 0);
  const aumWithOpp = Number(data.summary?.aum_with_opp ?? 0);

  const productRows = CROSS_SELL_PRODUCTS.map(([k, label]) => ({
    key: k,
    label,
    count: Number(data.products?.[k] ?? 0),
  }))
    .sort((a, b) => b.count - a.count);
  const maxProduct = Math.max(1, ...productRows.map((p) => p.count));

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="page-title">
          <TrendingUp className="size-6 text-violet-600" /> Cross-sell opportunities
        </h1>
        <p className="page-subtitle">
          Wallet-share growth worklist — clients who hold products elsewhere, are interested, or don't hold
          them yet. Deepen the book product-by-product.
        </p>
      </div>

      {/* Headline */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-3">
        <Tile label="Clients with opportunities" value={String(withOpp)} sub={`of ${totalActive} active`} tone="violet" />
        <Tile label="AUM in play" value={inrCompact(aumWithOpp)} sub="held by those clients" tone="emerald" />
        <Tile
          label="Coverage"
          value={totalActive ? `${Math.round((withOpp / totalActive) * 100)}%` : "—"}
          sub="of the book has an open opportunity"
          tone="sky"
        />
      </div>

      {/* Per-product breakdown */}
      <div className="card-surface p-5">
        <h2 className="font-semibold text-sm mb-3">Opportunities by product</h2>
        {productRows.every((p) => p.count === 0) ? (
          <p className="text-sm text-muted-foreground">
            No cross-sell data captured yet. Mark holdings on each Client 360 → "Cross-sell / holdings".
          </p>
        ) : (
          <div className="space-y-2">
            {productRows.map((p) => (
              <Link
                key={p.key}
                href={`/dashboard/investors?cross_sell_opp=1`}
                className="flex items-center gap-3 group"
              >
                <span className="w-40 text-sm truncate">{p.label}</span>
                <div className="flex-1 h-5 bg-secondary/50 rounded overflow-hidden">
                  <div
                    className="h-full bg-violet-500/80 group-hover:bg-violet-500 transition-colors"
                    style={{ width: `${Math.round((p.count / maxProduct) * 100)}%` }}
                  />
                </div>
                <span className="w-10 text-right text-sm font-semibold tabular-nums">{p.count}</span>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Top clients */}
      <div className="card-surface overflow-hidden">
        <div className="px-4 py-3 border-b bg-secondary/30 flex items-center justify-between">
          <h2 className="font-semibold text-sm flex items-center gap-2">
            <Users className="size-4" /> Top clients by open opportunities
          </h2>
          <Link href="/dashboard/investors?cross_sell_opp=1" className="text-xs font-medium text-brand-cyan-deep hover:underline">
            View all →
          </Link>
        </div>
        {data.top.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No clients with open cross-sell opportunities yet.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Client</th>
                <th className="text-right py-2 font-medium">AUM</th>
                <th className="text-left py-2 font-medium pl-4">RM</th>
                <th className="text-left py-2 font-medium">Opportunities</th>
              </tr>
            </thead>
            <tbody>
              {data.top.map((c) => {
                const opps = crossSellOpportunities(c.cross_sell);
                return (
                  <tr key={c.id} className="border-b last:border-0 hover:bg-accent/40 align-top">
                    <td className="px-4 py-2.5 font-medium">
                      <Link href={`/dashboard/investors/${c.id}`} className="hover:underline">{c.name}</Link>
                    </td>
                    <td className="py-2.5 text-right tabular-nums">{formatINR(Number(c.aum ?? 0))}</td>
                    <td className="py-2.5 pl-4 text-xs text-muted-foreground">{data.rmMap.get(c.rm_id) ?? "—"}</td>
                    <td className="py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {opps.map((o) => (
                          <span key={o.key} className={`chip text-[11px] border ${crossSellStatusTone(o.status)}`}>
                            {o.label} · {crossSellStatusLabel(o.status)}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone: "violet" | "emerald" | "sky" }) {
  const cls = tone === "violet" ? "text-violet-600" : tone === "emerald" ? "text-emerald-600" : "text-sky-600";
  return (
    <div className="card-surface p-4">
      <div className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">{label}</div>
      <div className={`text-2xl font-bold mt-1 tabular-nums ${cls}`}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}
