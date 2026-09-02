/**
 * Metric registry for the monthly branch-metric MIS reports. CLIENT-SAFE —
 * no DB imports — so both the report page (client) and the service (server)
 * share one source of truth for labels, units and routing.
 *
 * To add a new monthly-meeting report of the same shape (branch-wise Target ·
 * this-month · % achievement · last-month · MoM), add one entry here plus its
 * live-rollup SQL in metric-status.ts (LIVE_SOURCE) — the page, API and report
 * card all pick it up.
 */

export type MetricKey = "aum" | "sip_book";

export type MetricMeta = {
  key: MetricKey;
  slug: string; // route slug under /dashboard/reports/metric/<slug>
  /** Report H1, e.g. "AUM Status". */
  title: string;
  /** Short noun for the value column, e.g. "AUM" / "SIP Book". */
  label: string;
  /** Display unit, e.g. "Cr" / "Lakh". */
  unit: string;
  /** Rupees per one display unit (₹ ÷ this = unit). 1e7 = Cr, 1e5 = Lakh. */
  rupeesPerUnit: number;
  /** Column header prefix, e.g. "AUM as on" / "SIP Book as on". */
  asOnPrefix: string;
};

export const METRICS: Record<MetricKey, MetricMeta> = {
  aum: {
    key: "aum",
    slug: "aum",
    title: "AUM Status",
    label: "AUM",
    unit: "Cr",
    rupeesPerUnit: 1e7,
    asOnPrefix: "AUM as on",
  },
  sip_book: {
    key: "sip_book",
    slug: "sip-book",
    title: "SIP Book Size",
    label: "SIP Book",
    unit: "Lakh",
    rupeesPerUnit: 1e5,
    asOnPrefix: "SIP Book as on",
  },
};

export const METRIC_LIST: MetricMeta[] = Object.values(METRICS);

export function metricBySlug(slug: string): MetricMeta | undefined {
  return METRIC_LIST.find((m) => m.slug === slug);
}

export function isMetricKey(k: string): k is MetricKey {
  return k === "aum" || k === "sip_book";
}

/**
 * Indian-FY label for a 'YYYY-MM' period, e.g. 2026-05 → "26-27" (FY Apr–Mar).
 * Used to render the "Target 26-27" column header dynamically.
 */
export function fyLabel(period: string): string {
  const [y, m] = period.split("-").map(Number);
  const startYear = m >= 4 ? y : y - 1; // Apr starts the FY
  const a = String(startYear % 100).padStart(2, "0");
  const b = String((startYear + 1) % 100).padStart(2, "0");
  return `${a}-${b}`;
}
