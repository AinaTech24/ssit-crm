/**
 * Business Closing Entries — server-side aggregations for the dashboard + the
 * Liquid-for-switching report. All queries run inside an existing withTenant()
 * transaction (RLS scopes them to the tenant); an optional rmId narrows to one
 * relationship manager.
 */

import { sql } from "drizzle-orm";

export type BusinessSummary = {
  gross: number;
  entries: number;
  clients: number;
  sipAmount: number;
  byAssetClass: Array<{ key: string; amount: number }>;
  byTxnType: Array<{ key: string; amount: number }>;
  byProduct: Array<{ key: string; amount: number }>;
  byMonth: Array<{ month: string; amount: number }>;
  topClients: Array<{ investorId: string | null; name: string; amount: number }>;
  byRm: Array<{ rmId: string | null; name: string; amount: number; entries: number; clients: number }>;
  byBranch: Array<{ branchId: string | null; name: string; amount: number; entries: number; clients: number }>;
};

function rmCond(rmId?: string | null) {
  return rmId ? sql` AND e.rm_id = ${rmId}::uuid` : sql``;
}

/**
 * Branch is not stored on the entry — it is derived through the booking RM's
 * branch. That is the only link there is, and it means reassigning an RM to
 * another branch moves their HISTORY too. Worth knowing before reading these
 * numbers as a fixed record of where business was booked.
 */
function branchCond(branchId?: string | null) {
  return branchId
    ? sql` AND EXISTS (SELECT 1 FROM users bu WHERE bu.id = e.rm_id AND bu.branch_id = ${branchId}::uuid)`
    : sql``;
}

export async function getBusinessSummary(
  tx: any,
  tenantId: string,
  opts: {
    fromISO: string;
    toISO: string;
    rmId?: string | null;
    branchId?: string | null;
    productType?: string | null;
    status?: string | null;
  }
): Promise<BusinessSummary> {
  const { fromISO, toISO, rmId, branchId, productType, status } = opts;
  // A specific status narrows to exactly that; otherwise show all booked business
  // (everything except cancelled) — the dashboard's default.
  const statusCond = status ? sql` AND e.status = ${status}` : sql` AND e.status <> 'cancelled'`;
  const productCond = productType ? sql` AND e.product_type = ${productType}` : sql``;
  const whereFrag = sql`
    WHERE e.tenant_id = ${tenantId}::uuid${statusCond}
      AND e.business_date >= ${fromISO}::date
      AND e.business_date <= ${toISO}::date${rmCond(rmId)}${branchCond(branchId)}${productCond}
  `;
  const base = sql`
    FROM business_entry_lines l
    JOIN business_entries e ON e.id = l.entry_id
    ${whereFrag}
  `;
  // Same rows, plus the RM and their branch. LEFT JOINs so an entry with no RM
  // (or an RM with no branch) still appears, under "Unassigned".
  const baseWithOrg = sql`
    FROM business_entry_lines l
    JOIN business_entries e ON e.id = l.entry_id
    LEFT JOIN users u ON u.id = e.rm_id
    LEFT JOIN branches br ON br.id = u.branch_id
    ${whereFrag}
  `;

  const totals = (await tx.execute(sql`
    SELECT
      COALESCE(SUM(l.amount), 0)::numeric AS gross,
      COUNT(DISTINCT e.id)::int AS entries,
      COUNT(DISTINCT e.investor_id)::int AS clients,
      COALESCE(SUM(l.amount) FILTER (WHERE l.txn_type IN ('sip','sip_topup')), 0)::numeric AS sip_amount
    ${base}
  `)).rows[0] as any;

  const byClass = (await tx.execute(sql`SELECT l.asset_class AS key, COALESCE(SUM(l.amount),0)::numeric AS amount ${base} GROUP BY l.asset_class ORDER BY amount DESC`)).rows as any[];
  const byType = (await tx.execute(sql`SELECT l.txn_type AS key, COALESCE(SUM(l.amount),0)::numeric AS amount ${base} GROUP BY l.txn_type ORDER BY amount DESC`)).rows as any[];
  const byProduct = (await tx.execute(sql`SELECT e.product_type AS key, COALESCE(SUM(l.amount),0)::numeric AS amount ${base} GROUP BY e.product_type ORDER BY amount DESC`)).rows as any[];
  const byMonth = (await tx.execute(sql`
    SELECT to_char(date_trunc('month', e.business_date), 'YYYY-MM') AS month,
           COALESCE(SUM(l.amount),0)::numeric AS amount
    ${base} GROUP BY 1 ORDER BY 1
  `)).rows as any[];
  const top = (await tx.execute(sql`
    SELECT e.investor_id AS investor_id, MAX(e.client_name) AS name, COALESCE(SUM(l.amount),0)::numeric AS amount
    ${base} GROUP BY e.investor_id ORDER BY amount DESC LIMIT 10
  `)).rows as any[];

  // RM-wise and branch-wise splits of the same filtered set. Unassigned entries
  // (no rm_id, or an RM with no branch) are kept and labelled rather than
  // dropped — silently losing rows from a total is worse than an "Unassigned"
  // line that prompts someone to fix the data.
  const byRm = (await tx.execute(sql`
    SELECT e.rm_id AS id,
           COALESCE(MAX(u.name), 'Unassigned') AS name,
           COALESCE(SUM(l.amount), 0)::numeric AS amount,
           COUNT(DISTINCT e.id)::int AS entries,
           COUNT(DISTINCT e.investor_id)::int AS clients
    ${baseWithOrg}
    GROUP BY e.rm_id
    ORDER BY amount DESC
  `)).rows as any[];

  const byBranch = (await tx.execute(sql`
    SELECT br.id AS id,
           COALESCE(MAX(br.name), 'Unassigned') AS name,
           COALESCE(SUM(l.amount), 0)::numeric AS amount,
           COUNT(DISTINCT e.id)::int AS entries,
           COUNT(DISTINCT e.investor_id)::int AS clients
    ${baseWithOrg}
    GROUP BY br.id
    ORDER BY amount DESC
  `)).rows as any[];

  return {
    gross: Number(totals?.gross ?? 0),
    entries: Number(totals?.entries ?? 0),
    clients: Number(totals?.clients ?? 0),
    sipAmount: Number(totals?.sip_amount ?? 0),
    byAssetClass: byClass.map((r) => ({ key: r.key, amount: Number(r.amount) })),
    byTxnType: byType.map((r) => ({ key: r.key, amount: Number(r.amount) })),
    byProduct: byProduct.map((r) => ({ key: r.key, amount: Number(r.amount) })),
    byMonth: byMonth.map((r) => ({ month: r.month, amount: Number(r.amount) })),
    topClients: top.map((r) => ({ investorId: r.investor_id, name: r.name ?? "—", amount: Number(r.amount) })),
    byRm: byRm.map((r) => ({
      rmId: r.id, name: r.name, amount: Number(r.amount),
      entries: Number(r.entries), clients: Number(r.clients),
    })),
    byBranch: byBranch.map((r) => ({
      branchId: r.id, name: r.name, amount: Number(r.amount),
      entries: Number(r.entries), clients: Number(r.clients),
    })),
  };
}

export type LiquidRow = {
  investorId: string | null;
  name: string;
  liquidIn: number;
  liquidOut: number;
  liquidNet: number;
  lastDate: string | null;
};

/**
 * Per-client net money parked in LIQUID (liquid-in − liquid-out), ranked — the
 * "dry powder" available to switch into equity on a market dip.
 *   liquid-in  = money landing in a liquid scheme (lumpsum/add'l/switch-in/stp-in)
 *   liquid-out = money leaving liquid (redeemed/SWP from liquid, or switched/STP'd
 *                OUT of liquid into something else)
 */
export async function getLiquidParkingReport(
  tx: any,
  tenantId: string,
  opts: { rmId?: string | null } = {}
): Promise<LiquidRow[]> {
  const rows = (await tx.execute(sql`
    SELECT * FROM (
      SELECT e.investor_id AS investor_id,
             MAX(e.client_name) AS name,
             COALESCE(SUM(l.amount) FILTER (
               WHERE l.asset_class = 'liquid' AND l.txn_type IN ('lumpsum','additional_purchase','switch','stp')
             ), 0)::numeric AS liquid_in,
             COALESCE(SUM(l.amount) FILTER (
               WHERE (l.asset_class = 'liquid' AND l.txn_type IN ('swp','redemption'))
                  OR (l.from_asset_class = 'liquid' AND l.txn_type IN ('switch','stp'))
             ), 0)::numeric AS liquid_out,
             MAX(e.business_date) AS last_date
      FROM business_entry_lines l
      JOIN business_entries e ON e.id = l.entry_id
      WHERE e.tenant_id = ${tenantId}::uuid
        AND e.status <> 'cancelled'${rmCond(opts.rmId)}
      GROUP BY e.investor_id
    ) t
    WHERE t.liquid_in - t.liquid_out > 0
    ORDER BY t.liquid_in - t.liquid_out DESC
    LIMIT 500
  `)).rows as any[];

  return rows.map((r) => {
    const liquidIn = Number(r.liquid_in);
    const liquidOut = Number(r.liquid_out);
    return {
      investorId: r.investor_id,
      name: r.name ?? "—",
      liquidIn,
      liquidOut,
      liquidNet: liquidIn - liquidOut,
      lastDate: r.last_date ?? null,
    };
  });
}
