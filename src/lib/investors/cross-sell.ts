/**
 * Cross-sell / product-holdings catalog (Sanchay "Cross Selling" parity).
 *
 * For an MFD, wallet-share expansion is the #1 growth lever: knowing which
 * clients hold which products — and which they hold *elsewhere* or don't hold
 * at all — turns the client master into a cross-sell opportunity engine.
 *
 * Stored as a JSONB map on investors.crossSell: { productKey: statusKey }.
 */

/**
 * Order is the firm's, and it is load-bearing: the holdings card renders the
 * first CROSS_SELL_COLUMN_SPLIT entries down the left column and the rest down
 * the right, so moving an entry here moves it on screen.
 *
 * KEYS ARE STORAGE. Labels can be reworded freely, but a key rename orphans
 * every investor row already carrying it — which is why "loan" keeps its key
 * while reading "Loan Against Share".
 */
export const CROSS_SELL_PRODUCTS = [
  // Left column — the investment side.
  ["mutual_funds", "Mutual Fund"],
  ["demat", "Demat A/c"],
  ["pms", "PMS"],
  ["aif", "AIF"],
  ["gift_city", "Gift City"],
  // Right column — lending, protection and fixed income.
  ["loan", "Loan Against Share"],
  ["life_insurance", "Life Insurance"],
  ["general_insurance", "General Insurance"],
  ["health_insurance", "Health Mediclaim"],
  ["fd_bonds_ncd", "FD / Bonds / NCD"],
  ["nps", "NPS"],
] as const;

/** Entries before this index go in the left column, the rest on the right. */
export const CROSS_SELL_COLUMN_SPLIT = 5;

export const CROSS_SELL_STATUSES = [
  ["held_with_us", "Held with us"],
  ["held_elsewhere", "Held elsewhere"],
  ["interested", "Interested"],
  ["not_held", "Not held"],
  ["not_applicable", "N/A"],
] as const;

export const CROSS_SELL_PRODUCT_KEYS = CROSS_SELL_PRODUCTS.map(([k]) => k);
export const CROSS_SELL_STATUS_KEYS = CROSS_SELL_STATUSES.map(([k]) => k);

export type CrossSellMap = Record<string, string>;

/** Statuses that represent an open wallet-share opportunity. */
const OPPORTUNITY = new Set(["held_elsewhere", "interested", "not_held"]);

/** Priority for ranking opportunities (higher = hotter). */
const STRENGTH: Record<string, number> = {
  interested: 3,
  held_elsewhere: 2,
  not_held: 1,
};

export type CrossSellOpportunity = { key: string; label: string; status: string; strength: number };

/** The open cross-sell opportunities for a client, hottest first. */
export function crossSellOpportunities(map: CrossSellMap | null | undefined): CrossSellOpportunity[] {
  if (!map) return [];
  const out: CrossSellOpportunity[] = [];
  for (const [key, label] of CROSS_SELL_PRODUCTS) {
    const status = map[key];
    if (status && OPPORTUNITY.has(status)) {
      out.push({ key, label, status, strength: STRENGTH[status] ?? 0 });
    }
  }
  return out.sort((a, b) => b.strength - a.strength);
}

/** Count of products this client holds *with us* (revenue lines). */
export function heldWithUsCount(map: CrossSellMap | null | undefined): number {
  if (!map) return 0;
  return CROSS_SELL_PRODUCTS.filter(([k]) => map[k] === "held_with_us").length;
}

export function crossSellStatusLabel(status: string | undefined): string {
  if (!status) return "—";
  return CROSS_SELL_STATUSES.find(([k]) => k === status)?.[1] ?? status;
}

/** Tone classes for a status chip. */
export function crossSellStatusTone(status: string | undefined): string {
  switch (status) {
    case "held_with_us": return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "interested": return "bg-rose-50 text-rose-700 border-rose-200"; // hot opportunity
    case "held_elsewhere": return "bg-amber-50 text-amber-700 border-amber-200"; // convert
    case "not_held": return "bg-sky-50 text-sky-700 border-sky-200"; // offer
    default: return "bg-muted text-muted-foreground border-border"; // n/a / unset
  }
}
