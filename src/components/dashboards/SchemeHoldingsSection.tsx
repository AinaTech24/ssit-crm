import React from "react";
import Link from "next/link";
import { sql } from "drizzle-orm";
import { Layers, Landmark } from "lucide-react";
import { withTenant } from "@/db/client";
import { formatINR } from "@/lib/utils";
import type { SessionUser } from "@/lib/auth/session";

/**
 * Scheme-wise client holdings + the firm's total SIF book.
 *
 * Holdings are derived from `transactions` rather than `folios`: the folio row
 * carries a single AUM figure and a jsonb blob, while transactions carry the
 * scheme name, the direction and the investor on every line — which is what
 * "which schemes are our clients actually in, and how many of them" needs.
 * Net invested = inflow − outflow, so a scheme that has been largely redeemed
 * stops looking like a big position.
 *
 * SIF sits apart because it is not a mutual-fund transaction at all: it is
 * booked through business entries, so its total comes from there. It is shown
 * ALL-TIME, not for the selected period — the cockpit already reports SIF net
 * flow for the period, and the question this answers is "how big is the SIF
 * book", which a period figure cannot tell you.
 */
export async function SchemeHoldingsSection({ session }: { session: SessionUser }) {
  const data = await withTenant(
    session.tenantId,
    async (tx) => {
      const schemesRes = await tx.execute(sql`
        WITH flows AS (
          SELECT l.scheme_name, l.amc_name, l.asset_category AS scheme_category, e.investor_id,
                 CASE WHEN l.txn_type IN ('sip','sip_topup','lumpsum','additional_purchase','switch','stp') THEN l.amount::numeric
                      WHEN l.txn_type IN ('redemption','swp') THEN -l.amount::numeric ELSE 0 END AS amt
            FROM business_entry_lines l JOIN business_entries e ON e.id = l.entry_id
           WHERE e.status <> 'cancelled'
          UNION ALL
          -- money leaving the scheme switched out of
          SELECT l.from_scheme_name, NULL, NULL, e.investor_id, -l.amount::numeric
            FROM business_entry_lines l JOIN business_entries e ON e.id = l.entry_id
           WHERE e.status <> 'cancelled' AND l.txn_type IN ('switch','stp') AND l.from_scheme_name IS NOT NULL
        )
        SELECT scheme_name, MAX(amc_name) AS amc_name, MAX(scheme_category) AS scheme_category,
               COUNT(DISTINCT investor_id)::int AS clients, COALESCE(SUM(amt), 0)::numeric AS net_invested
          FROM flows
         WHERE scheme_name IS NOT NULL
         GROUP BY scheme_name
        HAVING COALESCE(SUM(amt), 0) <> 0
        ORDER BY net_invested DESC
        LIMIT 12
      `);

      const sifRes = await tx.execute(sql`
        SELECT
          COALESCE(SUM((SELECT COALESCE(SUM(CASE WHEN l.txn_type IN ('redemption','swp') THEN -l.amount::numeric
                                                 WHEN l.txn_type IN ('sip_stop','cob') THEN 0 ELSE l.amount::numeric END), 0)
                          FROM business_entry_lines l WHERE l.entry_id = be.id)), 0)::numeric AS total,
          COUNT(*)::int AS entries,
          COUNT(DISTINCT be.investor_id)::int AS clients
        FROM business_entries be
        WHERE be.product_type = 'sif'
          AND be.status <> 'cancelled'
      `);

      return {
        schemes: schemesRes.rows as any[],
        sif: (sifRes.rows[0] as any) ?? { total: 0, entries: 0, clients: 0 },
      };
    },
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );

  const totalNet = data.schemes.reduce((a, r) => a + Number(r.net_invested), 0);

  return (
    <div className="card-surface glass-card p-5">
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <h2 className="font-semibold flex items-center gap-2">
          <div className="size-7 rounded-lg bg-indigo-50 grid place-items-center">
            <Layers className="size-3.5 text-indigo-600" />
          </div>
          Scheme-wise client holdings
        </h2>
        <Link href="/dashboard/business-entries" className="text-xs text-brand-cyan-deep hover:underline font-medium">
          All transactions →
        </Link>
      </div>

      {/* Total SIF book — booked through business entries, not MF transactions,
          so it cannot appear in the scheme table below. */}
      <div className="mb-4 rounded-lg border border-border bg-secondary/30 px-3 py-2.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Landmark className="size-4 text-muted-foreground" />
          <div>
            <div className="text-xs font-semibold">Total SIF investments</div>
            <div className="text-[11px] text-muted-foreground">
              All time · {Number(data.sif.entries)} {Number(data.sif.entries) === 1 ? "entry" : "entries"} ·{" "}
              {Number(data.sif.clients)} {Number(data.sif.clients) === 1 ? "client" : "clients"}
            </div>
          </div>
        </div>
        <div className="text-lg font-bold tabular-nums">{formatINR(Number(data.sif.total))}</div>
      </div>

      {data.schemes.length === 0 ? (
        <p className="text-xs text-muted-foreground py-6 text-center">
          No scheme holdings yet — they appear as business is booked in Transactions.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b border-border">
              <tr>
                <th className="text-left py-2 font-medium">Scheme</th>
                <th className="text-right py-2 font-medium">Clients</th>
                <th className="text-right py-2 font-medium">Net booked</th>
                <th className="text-right py-2 font-medium w-24">Share</th>
              </tr>
            </thead>
            <tbody>
              {data.schemes.map((r) => {
                const net = Number(r.net_invested);
                const pct = totalNet > 0 ? Math.round((net / totalNet) * 100) : 0;
                return (
                  <tr key={r.scheme_name} className="border-b border-border last:border-0">
                    <td className="py-2 pr-3">
                      <div className="font-medium truncate max-w-[22rem]">{r.scheme_name}</div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {[r.amc_name, r.scheme_category].filter(Boolean).join(" · ") || "—"}
                      </div>
                    </td>
                    <td className="py-2 text-right tabular-nums">{r.clients}</td>
                    <td className="py-2 text-right tabular-nums font-medium">{formatINR(net)}</td>
                    <td className="py-2 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="h-1.5 w-12 rounded-full bg-secondary overflow-hidden">
                          <div className="h-full bg-brand-cyan" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-[11px] text-muted-foreground tabular-nums w-7">{pct}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
