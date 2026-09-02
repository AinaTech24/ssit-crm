/**
 * Registry for the branch + RM-wise business reports ("Anand DK SIP",
 * "… Equity Lumpsum", "… Liquid Lumpsum", "… Insurance"). CLIENT-SAFE — no DB
 * imports — shared by the report page (client) and the compute engine (server).
 *
 * Each kind scopes to ONE branch + ONE month, lists each branch RM as a row plus
 * an "Outside to our" residual + a TOTAL, and shows 2–3 measured columns. The
 * column predicates (what SQL each column sums) live server-side in rm-matrix.ts.
 *
 * To add a kind (e.g. Debt Lumpsum): add an entry here + its column predicates
 * in rm-matrix.ts — the page, API and report card pick it up.
 */

export type RmMatrixKey = "sip" | "equity_lumpsum" | "liquid_lumpsum" | "insurance";

export type RmMatrixMeta = {
  key: RmMatrixKey;
  slug: string;
  title: string; // e.g. "SIP", "Equity Lumpsum"
  source: "business_entries" | "insurance";
  columns: { key: string; label: string }[];
  /** When true, append a derived "Net" column = columns[0] − columns[1]. */
  hasNet: boolean;
};

export const RM_MATRIX: Record<RmMatrixKey, RmMatrixMeta> = {
  sip: {
    key: "sip",
    slug: "sip",
    title: "SIP",
    source: "business_entries",
    columns: [
      { key: "gross", label: "Gross" },
      { key: "stop", label: "Stop" },
    ],
    hasNet: true,
  },
  equity_lumpsum: {
    key: "equity_lumpsum",
    slug: "equity-lumpsum",
    title: "Equity Lumpsum",
    source: "business_entries",
    columns: [
      { key: "gross", label: "Gross" },
      { key: "redemption", label: "Redemption" },
    ],
    hasNet: true,
  },
  liquid_lumpsum: {
    key: "liquid_lumpsum",
    slug: "liquid-lumpsum",
    title: "Liquid Lumpsum",
    source: "business_entries",
    columns: [
      { key: "gross", label: "Gross" },
      { key: "redemption", label: "Redemption" },
    ],
    hasNet: true,
  },
  insurance: {
    key: "insurance",
    slug: "insurance",
    title: "Insurance",
    source: "insurance",
    columns: [
      { key: "life", label: "Life" },
      { key: "health", label: "Health" },
      { key: "other", label: "Other" },
    ],
    hasNet: false,
  },
};

export const RM_MATRIX_LIST: RmMatrixMeta[] = Object.values(RM_MATRIX);

export function rmMatrixBySlug(slug: string): RmMatrixMeta | undefined {
  return RM_MATRIX_LIST.find((m) => m.slug === slug);
}

export function isRmMatrixKey(k: string): k is RmMatrixKey {
  return k === "sip" || k === "equity_lumpsum" || k === "liquid_lumpsum" || k === "insurance";
}
