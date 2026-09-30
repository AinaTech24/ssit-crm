/**
 * Widget catalog — CLIENT-SAFE metadata (no DB imports). Drives the builder's
 * widget palette and the card chrome. The matching SQL + per-type view config
 * lives server-side in widget-sql.ts (imported only by the data API route).
 *
 * To add a widget: append a row here AND a matching entry in widget-sql.ts.
 */

export type WidgetType = "kpi" | "chart" | "funnel" | "table" | "meter" | "comparator";
export type ChartKind = "line" | "bar" | "area" | "donut";

export interface WidgetMeta {
  key: string;
  title: string;
  category: "Sales" | "SIP" | "Clients" | "Leads" | "Compliance" | "Team";
  type: WidgetType;
  desc: string;
  /** Default size on the 4-column grid. */
  defaultColSpan: 1 | 2 | 3 | 4;
  defaultRowSpan: 1 | 2 | 3;
  chart?: ChartKind;
  /** Widget honours the board/own RM filter. */
  supportsRm?: boolean;
}

export const WIDGET_META: WidgetMeta[] = [
  // ── KPIs ──────────────────────────────────────────────────────────────
  { key: "kpi_aum", title: "Total AUM", category: "Sales", type: "kpi", desc: "Live assets under management.", defaultColSpan: 1, defaultRowSpan: 1, supportsRm: true },
  { key: "kpi_net_sales_mtd", title: "Net Business (MTD)", category: "Sales", type: "kpi", desc: "Transactions: inflow − outflow, month to date.", defaultColSpan: 1, defaultRowSpan: 1 },
  { key: "kpi_gross_business_mtd", title: "Gross Business (MTD)", category: "Sales", type: "kpi", desc: "Transactions: all purchases booked this month.", defaultColSpan: 1, defaultRowSpan: 1 },
  { key: "kpi_active_sip", title: "Active SIP Book", category: "SIP", type: "kpi", desc: "Monthly SIP run-rate.", defaultColSpan: 1, defaultRowSpan: 1, supportsRm: true },
  { key: "kpi_clients", title: "Active Clients", category: "Clients", type: "kpi", desc: "Count of active clients.", defaultColSpan: 1, defaultRowSpan: 1, supportsRm: true },
  { key: "kpi_new_leads_mtd", title: "New Leads (MTD)", category: "Leads", type: "kpi", desc: "Leads added this month.", defaultColSpan: 1, defaultRowSpan: 1, supportsRm: true },
  { key: "kpi_conversion_rate", title: "Lead Conversion %", category: "Leads", type: "kpi", desc: "Lifetime lead → client rate.", defaultColSpan: 1, defaultRowSpan: 1, supportsRm: true },
  { key: "kpi_open_tasks", title: "Open Tasks", category: "Team", type: "kpi", desc: "Open + in-progress tasks.", defaultColSpan: 1, defaultRowSpan: 1, supportsRm: true },
  { key: "kpi_overdue_reviews", title: "Overdue Reviews", category: "Clients", type: "kpi", desc: "Active clients past review date.", defaultColSpan: 1, defaultRowSpan: 1, supportsRm: true },

  // ── Charts ────────────────────────────────────────────────────────────
  { key: "chart_net_sales", title: "Net Business Trend", category: "Sales", type: "chart", chart: "area", desc: "Transactions: daily net business — last 30 days.", defaultColSpan: 2, defaultRowSpan: 2 },
  { key: "chart_business_by_product", title: "Business by Product", category: "Sales", type: "chart", chart: "donut", desc: "Transactions: mix by product (MF / PMS / AIF…) — 90 days.", defaultColSpan: 1, defaultRowSpan: 2 },
  { key: "chart_aum_movement", title: "AUM Movement", category: "Sales", type: "chart", chart: "bar", desc: "Inflow vs outflow — last 12 months.", defaultColSpan: 2, defaultRowSpan: 2 },
  { key: "chart_amc_business", title: "AMC-wise Business", category: "Sales", type: "chart", chart: "bar", desc: "Net business by AMC — last 90 days.", defaultColSpan: 2, defaultRowSpan: 2 },
  { key: "chart_scheme_category", title: "Category Mix", category: "Sales", type: "chart", chart: "donut", desc: "Net business by scheme category.", defaultColSpan: 1, defaultRowSpan: 2 },

  // ── Comparator + Target meter ─────────────────────────────────────────
  { key: "cmp_net_sales_mom", title: "Net Business — MoM", category: "Sales", type: "comparator", desc: "This month vs last month, with change.", defaultColSpan: 2, defaultRowSpan: 1 },
  { key: "cmp_new_clients_mom", title: "New Clients — MoM", category: "Clients", type: "comparator", desc: "Clients onboarded this vs last month.", defaultColSpan: 2, defaultRowSpan: 1 },
  { key: "meter_new_clients_target", title: "New Clients vs Target", category: "Clients", type: "meter", desc: "FY progress against your new-client target.", defaultColSpan: 2, defaultRowSpan: 1 },

  // ── Funnel ────────────────────────────────────────────────────────────
  { key: "funnel_blueprint", title: "Lead → Client Funnel", category: "Leads", type: "funnel", desc: "How many leads ever reached each stage.", defaultColSpan: 2, defaultRowSpan: 2 },

  // ── Tables / lists ────────────────────────────────────────────────────
  { key: "table_high_aum", title: "Top Clients by AUM", category: "Clients", type: "table", desc: "Your largest relationships.", defaultColSpan: 2, defaultRowSpan: 2, supportsRm: true },
  { key: "table_dormant", title: "Dormant Clients", category: "Clients", type: "table", desc: "No transaction in 180+ days.", defaultColSpan: 2, defaultRowSpan: 2, supportsRm: true },
  { key: "table_review_pending", title: "Reviews Due", category: "Clients", type: "table", desc: "Clients with a review due/overdue.", defaultColSpan: 2, defaultRowSpan: 2, supportsRm: true },
  { key: "table_sla_leads", title: "SLA-overdue Leads", category: "Leads", type: "table", desc: "Leads past their stage SLA.", defaultColSpan: 2, defaultRowSpan: 2 },
  { key: "table_sip_rejected", title: "Recent SIP Rejections", category: "SIP", type: "table", desc: "Latest rejected SIPs to recover.", defaultColSpan: 2, defaultRowSpan: 2 },
  { key: "table_open_complaints", title: "Open Complaints", category: "Compliance", type: "table", desc: "SEBI complaints in progress.", defaultColSpan: 2, defaultRowSpan: 2 },
  { key: "table_rm_business", title: "RM Leaderboard", category: "Team", type: "table", desc: "AUM + SIP book by RM.", defaultColSpan: 2, defaultRowSpan: 2 },
];

export const WIDGET_META_BY_KEY: Record<string, WidgetMeta> = Object.fromEntries(
  WIDGET_META.map((w) => [w.key, w])
);

export const WIDGET_CATEGORIES = ["Sales", "SIP", "Clients", "Leads", "Compliance", "Team"] as const;

export interface PlacedWidget {
  id: string;
  widgetKey: string;
  colSpan: number;
  rowSpan: number;
  title?: string;
  config?: { period?: string; rm?: string; [k: string]: unknown };
}

const clamp = (n: any, lo: number, hi: number, dflt: number) => {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt;
};

/** Validate + normalize a layout from the client: drop unknown widgets, clamp
 *  spans, cap count. Used by the save API and the builder. */
/** Whitelist + clamp a custom-chart component's declarative config. The actual
 *  SQL safety is enforced server-side (buildCustomChart only references catalog
 *  field `.sql` fragments), so here we just bound the shape + lengths. */
function sanitizeChartConfig(c: any): Record<string, unknown> {
  const aggs = ["count", "count_unique", "sum", "avg", "min", "max"];
  const grains = ["day", "week", "month", "quarter", "year"];
  return {
    subject: String(c.subject).slice(0, 40),
    chartType: String(c.chartType).slice(0, 20),
    agg: aggs.includes(c.agg) ? c.agg : "count",
    field: typeof c.field === "string" ? c.field.slice(0, 80) : undefined,
    groupBy: typeof c.groupBy === "string" ? c.groupBy.slice(0, 80) : undefined,
    dateGrain: grains.includes(c.dateGrain) ? c.dateGrain : undefined,
    limit: Number.isFinite(Number(c.limit)) ? Math.min(50, Math.max(1, Math.round(Number(c.limit)))) : undefined,
    title: typeof c.title === "string" ? c.title.slice(0, 120) : undefined,
    ast: c.ast && typeof c.ast === "object" ? c.ast : undefined,
  };
}

export function sanitizeLayout(input: unknown): PlacedWidget[] {
  if (!Array.isArray(input)) return [];
  const out: PlacedWidget[] = [];
  for (const raw of input.slice(0, 60)) {
    const r = raw as any;
    // Custom analytics component — no static meta; keep its declarative config.
    if (r?.widgetKey === "custom_chart") {
      const c = r.config && typeof r.config === "object" ? r.config : null;
      if (!c || typeof c.subject !== "string" || typeof c.chartType !== "string") continue;
      out.push({
        id: typeof r.id === "string" && r.id ? r.id : `custom-${out.length}`,
        widgetKey: "custom_chart",
        colSpan: clamp(r.colSpan, 1, 4, 2),
        rowSpan: clamp(r.rowSpan, 1, 3, 2),
        title: typeof r.title === "string" ? r.title.slice(0, 80) : undefined,
        config: sanitizeChartConfig(c),
      });
      continue;
    }
    const meta = WIDGET_META_BY_KEY[r?.widgetKey];
    if (!meta) continue;
    out.push({
      id: typeof r.id === "string" && r.id ? r.id : `${r.widgetKey}-${out.length}`,
      widgetKey: r.widgetKey,
      colSpan: clamp(r.colSpan, 1, 4, meta.defaultColSpan),
      rowSpan: clamp(r.rowSpan, 1, 3, meta.defaultRowSpan),
      title: typeof r.title === "string" ? r.title.slice(0, 80) : undefined,
      config: r.config && typeof r.config === "object"
        ? { rm: typeof r.config.rm === "string" ? r.config.rm : undefined }
        : undefined,
    });
  }
  return out;
}
