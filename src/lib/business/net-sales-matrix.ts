/**
 * Net-Sales matrix (Finowise MIS idea) — Gross Sales · Redemption · Net Sales by
 * execution platform, for a product vertical + month. SERVER-ONLY.
 *
 * Net = Gross − Redemption. Gross = inflow lines (lumpsum / additional / sip /
 * switch / stp); Redemption = outflow lines (redemption / swp). Source: business
 * entries + their lines.
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";

export const PRODUCT_OPTIONS: [string, string][] = [
  ["mutual_fund", "Mutual Fund"],
  ["pms", "PMS"],
  ["aif", "AIF"],
  ["sif", "SIF"],
  ["bond", "Bond"],
  ["ncd", "NCD"],
  ["p2p", "P2P"],
  ["las", "LAS"],
  ["other", "Other"],
  ["__all__", "All products"],
];

const ASSET_LABEL: Record<string, string> = {
  equity: "Equity",
  debt: "Debt",
  hybrid: "Hybrid",
  liquid: "Liquid",
  gold: "Gold",
  other: "Others",
};

export type NetSalesCell = { gross: number; redemption: number; net: number };
export type NetSalesRow = NetSalesCell & {
  kind: "platform" | "asset" | "platform_total";
  label: string;
  indent: boolean;
};
export type NetSalesMatrix = {
  period: string;
  productType: string;
  rows: NetSalesRow[];
  total: NetSalesCell;
};

const n = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};
function periodRange(period: string): { start: string; end: string } {
  const [y, m] = period.split("-").map(Number);
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const end = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return { start, end };
}

export async function loadNetSalesMatrix(tx: Tx, productType: string, period: string): Promise<NetSalesMatrix> {
  const { start, end } = periodRange(period);
  const all = productType === "__all__";
  const productCond = all ? sql`` : sql`AND be.product_type = ${productType}`;

  // One row per (platform, asset class) so each platform can be broken down.
  const res = await tx.execute(sql`
    SELECT COALESCE(NULLIF(be.platform, ''), '(Unspecified)') AS platform,
      COALESCE(bel.asset_class, 'other') AS asset_class,
      COALESCE(SUM(bel.amount) FILTER (WHERE bel.txn_type IN ('lumpsum','additional_purchase','sip','sip_topup','switch','stp')), 0)::numeric AS gross,
      COALESCE(SUM(bel.amount) FILTER (WHERE bel.txn_type IN ('redemption','swp')), 0)::numeric AS redemption
    FROM business_entries be
    JOIN business_entry_lines bel ON bel.entry_id = be.id
    WHERE be.status IN ('confirmed','emailed')
      AND be.business_date >= ${start} AND be.business_date < ${end}
      ${productCond}
    GROUP BY COALESCE(NULLIF(be.platform, ''), '(Unspecified)'), COALESCE(bel.asset_class, 'other')
  `);

  // Group by platform.
  const byPlatform = new Map<string, { asset: string; gross: number; redemption: number }[]>();
  for (const r of res.rows as Array<{ platform: string; asset_class: string; gross: string; redemption: string }>) {
    const arr = byPlatform.get(r.platform) ?? [];
    arr.push({ asset: r.asset_class, gross: n(r.gross), redemption: n(r.redemption) });
    byPlatform.set(r.platform, arr);
  }

  // Order platforms by total gross desc.
  const platformGross = (items: { gross: number }[]) => items.reduce((s, x) => s + x.gross, 0);
  const platforms = [...byPlatform.entries()].sort((a, b) => platformGross(b[1]) - platformGross(a[1]));

  const rows: NetSalesRow[] = [];
  const total: NetSalesCell = { gross: 0, redemption: 0, net: 0 };

  for (const [platform, items] of platforms) {
    items.sort((a, b) => b.gross - a.gross);
    const pTot = items.reduce(
      (a, it) => ({ gross: a.gross + it.gross, redemption: a.redemption + it.redemption, net: a.net + (it.gross - it.redemption) }),
      { gross: 0, redemption: 0, net: 0 }
    );
    // Platform header (carries the subtotal), then its asset-class rows indented.
    rows.push({ kind: "platform_total", label: platform, indent: false, ...pTot });
    for (const it of items) {
      rows.push({ kind: "asset", label: ASSET_LABEL[it.asset] ?? it.asset, indent: true, gross: it.gross, redemption: it.redemption, net: it.gross - it.redemption });
    }
    total.gross += pTot.gross;
    total.redemption += pTot.redemption;
    total.net += pTot.net;
  }

  return { period, productType, rows, total };
}
