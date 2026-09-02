/**
 * Map a mutual-fund scheme's master category (e.g. "Equity Scheme - Large Cap",
 * "Debt Scheme - Liquid Fund") to a normalised asset class used by the Business
 * Closing Entries reports + the Liquid-for-switching report.
 */

export type AssetClass = "equity" | "debt" | "liquid" | "hybrid" | "gold" | "other";

export const ASSET_CLASS_LABELS: Record<AssetClass, string> = {
  equity: "Equity",
  debt: "Debt",
  liquid: "Liquid",
  hybrid: "Hybrid",
  gold: "Gold / Commodity",
  other: "Other",
};

/** Order used when rendering the asset-class breakup. */
export const ASSET_CLASS_ORDER: AssetClass[] = ["equity", "hybrid", "debt", "liquid", "gold", "other"];

export function classifyAssetClass(category?: string | null, schemeName?: string | null): AssetClass {
  const s = `${category ?? ""} ${schemeName ?? ""}`.toLowerCase();
  if (!s.trim()) return "other";
  // Liquid first — it's a sub-set of "debt" but we track it separately for the
  // dry-powder report (liquid / overnight / money-market / ultra-short).
  if (/\b(liquid|overnight|money\s*market|ultra\s*short)\b/.test(s)) return "liquid";
  if (/\b(gold|silver|commodit)/.test(s)) return "gold";
  if (/\b(hybrid|balanced|asset allocation|multi[\s-]*asset|aggressive|conservative|arbitrage|equity savings|dynamic asset)\b/.test(s))
    return "hybrid";
  if (/\b(debt|bond|gilt|income|credit|corporate|duration|banking and psu|psu|dynamic bond|short duration|medium duration|long duration|floater|fmp|fixed maturity)\b/.test(s))
    return "debt";
  if (/\b(equity|elss|tax saver|large cap|mid cap|small cap|flexi cap|multi cap|focused|value|contra|dividend yield|sectoral|thematic|index|nifty|sensex)\b/.test(s))
    return "equity";
  return "other";
}
