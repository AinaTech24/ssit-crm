/**
 * MIS Report aggregation — turns raw Business-Entry lines + RTA-imported folio
 * AUM + firm targets into the MFD "MIS Summary" grid: per product group
 * (MF / Stocks / PMS / AIF / Misc) × asset class → AUM (from RTA folios) /
 * Gross Sales / Redemption / Net Sales, with sub-totals, a grand total, a
 * monthly Net-Sales trend, and Plan-vs-Actual against firm targets.
 *
 * Pure functions — the page does the withTenant queries and calls these.
 */

import { classifyAssetClass, type AssetClass, ASSET_CLASS_ORDER, ASSET_CLASS_LABELS } from "./asset-class";

/**
 * Gross inflow vs redemption. Mirrors the Net-Sales-matrix convention so MIS
 * numbers reconcile with the rest of the app: switch / STP count as gross
 * (money into the target asset class); `sip_stop` is a registration event, not
 * a money movement, so it touches neither column.
 */
const TXN_IN = new Set(["sip", "sip_topup", "lumpsum", "additional_purchase", "switch", "stp"]);
const TXN_OUT = new Set(["redemption", "swp"]);

export const PRODUCT_GROUPS: Array<{ key: string; label: string; types: string[] }> = [
  { key: "mf", label: "Mutual Fund", types: ["mutual_fund"] },
  { key: "stocks", label: "Stocks / Direct Equity", types: ["direct_equity"] },
  { key: "pms", label: "PMS", types: ["pms"] },
  { key: "aif", label: "AIF", types: ["aif"] },
  { key: "misc", label: "Miscellaneous", types: ["sif", "bond", "ncd", "p2p", "las", "other"] },
];

function groupOf(productType: string): string {
  return PRODUCT_GROUPS.find((g) => g.types.includes(productType))?.key ?? "misc";
}

export type MisLine = { productType: string; businessDate: string; assetClass: string; txnType: string; amount: number };
export type MisFolioScheme = { category?: string | null; schemeName?: string | null; value?: number | null };
export type MisFolio = { aum: number; schemes?: MisFolioScheme[] | null };
export type MisTarget = { metric: string; annualTarget: number };

export type MisCell = { aum: number; gross: number; redemption: number; net: number };
export type MisAssetRow = { assetClass: AssetClass; label: string } & MisCell;
export type MisProduct = { key: string; label: string; rows: MisAssetRow[]; subtotal: MisCell };

export type MisResult = {
  fy: string;
  products: MisProduct[];
  grandTotal: MisCell;
  monthlyNet: number[]; // 12 entries, Apr → Mar
  totalAum: number;
  planVsActual: Array<{ metric: string; label: string; plan: number; actual: number }>;
};

/** First calendar year of an FY string like "2025-26". */
export function fyStartYear(fy: string): number {
  return parseInt(fy.slice(0, 4), 10) || new Date().getFullYear();
}

/** Apr = 0 … Mar = 11 for a YYYY-MM-DD date. */
function fyMonthIndex(dateStr: string): number {
  const mon = Number((dateStr || "").slice(5, 7)) - 1; // 0=Jan
  if (Number.isNaN(mon)) return 0;
  return (mon - 3 + 12) % 12;
}

const emptyCell = (): MisCell => ({ aum: 0, gross: 0, redemption: 0, net: 0 });
const addCell = (a: MisCell, b: MisCell): MisCell => ({
  aum: a.aum + b.aum,
  gross: a.gross + b.gross,
  redemption: a.redemption + b.redemption,
  net: a.net + b.net,
});

export const MIS_MONTH_LABELS = ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"];

export function buildMisSummary(input: {
  fy: string;
  lines: MisLine[];
  folios: MisFolio[];
  targets: MisTarget[];
}): MisResult {
  // ── AUM by asset class (MF), from RTA-imported folios ──
  const aumByClass: Partial<Record<AssetClass, number>> = {};
  let totalAum = 0;
  for (const f of input.folios) {
    const schemes = f.schemes ?? [];
    if (schemes.length) {
      for (const s of schemes) {
        const ac = classifyAssetClass(s.category, s.schemeName);
        const v = Number(s.value ?? 0);
        aumByClass[ac] = (aumByClass[ac] ?? 0) + v;
        totalAum += v;
      }
    } else {
      const v = Number(f.aum ?? 0);
      aumByClass.other = (aumByClass.other ?? 0) + v;
      totalAum += v;
    }
  }

  // ── Flows by product group × asset class ──
  const grid: Record<string, Partial<Record<AssetClass, MisCell>>> = {};
  const monthlyNet = new Array(12).fill(0);
  let sipBook = 0;
  let lumpsum = 0;
  for (const ln of input.lines) {
    const grp = groupOf(ln.productType);
    const ac = (ASSET_CLASS_ORDER.includes(ln.assetClass as AssetClass) ? ln.assetClass : "other") as AssetClass;
    const amt = Number(ln.amount ?? 0);
    grid[grp] ??= {};
    grid[grp][ac] ??= emptyCell();
    const cell = grid[grp][ac]!;
    let net = 0;
    if (TXN_IN.has(ln.txnType)) {
      cell.gross += amt;
      net = amt;
    } else if (TXN_OUT.has(ln.txnType)) {
      cell.redemption += amt;
      net = -amt;
    }
    cell.net += net;
    monthlyNet[fyMonthIndex(ln.businessDate)] += net;
    if (ln.txnType === "sip") sipBook += amt;
    if (ln.txnType === "lumpsum") lumpsum += amt;
  }

  // ── Assemble products with sub-totals; fold folio AUM into the MF rows ──
  const products: MisProduct[] = [];
  let grandTotal = emptyCell();
  for (const g of PRODUCT_GROUPS) {
    const classes = grid[g.key] ?? {};
    const rows: MisAssetRow[] = [];
    let subtotal = emptyCell();
    for (const ac of ASSET_CLASS_ORDER) {
      const flow = classes[ac];
      const aum = g.key === "mf" ? (aumByClass[ac] ?? 0) : 0;
      if (!flow && aum === 0) continue;
      const row: MisAssetRow = {
        assetClass: ac,
        label: ASSET_CLASS_LABELS[ac],
        aum,
        gross: flow?.gross ?? 0,
        redemption: flow?.redemption ?? 0,
        net: flow?.net ?? 0,
      };
      rows.push(row);
      subtotal = addCell(subtotal, { aum: row.aum, gross: row.gross, redemption: row.redemption, net: row.net });
    }
    if (rows.length === 0) continue;
    products.push({ key: g.key, label: g.label, rows, subtotal });
    grandTotal = addCell(grandTotal, subtotal);
  }

  // ── Plan vs Actual ──
  const targetMap: Record<string, number> = {};
  for (const t of input.targets) targetMap[t.metric] = Number(t.annualTarget ?? 0);
  const planVsActual = [
    { metric: "aum_addition", label: "Net Sales (AUM addition)", plan: targetMap.aum_addition ?? 0, actual: grandTotal.net },
    { metric: "sip_book_addition", label: "SIP book added", plan: targetMap.sip_book_addition ?? 0, actual: sipBook },
    { metric: "lumpsum_added", label: "Lumpsum added", plan: targetMap.lumpsum_added ?? 0, actual: lumpsum },
  ].filter((m) => m.plan > 0 || m.actual !== 0);

  return { fy: input.fy, products, grandTotal, monthlyNet, totalAum, planVsActual };
}
