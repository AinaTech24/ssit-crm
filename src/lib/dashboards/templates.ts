/**
 * Starter board templates — predefined "My Dashboards" layouts built ENTIRELY
 * from existing widget keys in widgets.ts. Surfaced on the boards list page as
 * "Start from a template": creating one makes a new board pre-populated with the
 * layout via the normal board-create path (sanitizeLayout runs server-side, so
 * any drift here is dropped rather than breaking a board).
 *
 * Each item is a partial PlacedWidget (id is assigned at creation); colSpan /
 * rowSpan default to the widget's catalog defaults when omitted.
 */

import { WIDGET_META_BY_KEY, type PlacedWidget } from "./widgets";

export interface BoardTemplate {
  key: string;
  name: string;
  description: string;
  /** Widget keys (+ optional size overrides) that make up the layout. */
  widgets: Array<{ widgetKey: string; colSpan?: number; rowSpan?: number; title?: string }>;
}

export const BOARD_TEMPLATES: BoardTemplate[] = [
  {
    key: "rm_cockpit",
    name: "RM Cockpit",
    description: "An RM's day: book size, open work, reviews due and dormant clients.",
    widgets: [
      { widgetKey: "kpi_aum" },
      { widgetKey: "kpi_active_sip" },
      { widgetKey: "kpi_clients" },
      { widgetKey: "kpi_open_tasks" },
      { widgetKey: "table_review_pending" },
      { widgetKey: "table_dormant" },
      { widgetKey: "table_high_aum" },
    ],
  },
  {
    key: "sales_overview",
    name: "Sales Overview",
    description: "Firm-wide business: net & gross flows, trend, product and AMC mix.",
    widgets: [
      { widgetKey: "kpi_net_sales_mtd" },
      { widgetKey: "kpi_gross_business_mtd" },
      { widgetKey: "cmp_net_sales_mom" },
      { widgetKey: "chart_net_sales" },
      { widgetKey: "chart_business_by_product" },
      { widgetKey: "chart_amc_business" },
      { widgetKey: "chart_scheme_category" },
    ],
  },
  {
    key: "leads_pipeline",
    name: "Leads & Pipeline",
    description: "Top of funnel: new leads, conversion, the blueprint funnel and SLA breaches.",
    widgets: [
      { widgetKey: "kpi_new_leads_mtd" },
      { widgetKey: "kpi_conversion_rate" },
      { widgetKey: "cmp_new_clients_mom" },
      { widgetKey: "meter_new_clients_target" },
      { widgetKey: "funnel_blueprint" },
      { widgetKey: "table_sla_leads" },
    ],
  },
  {
    key: "compliance_watch",
    name: "Compliance Watch",
    description: "Risk surface: open complaints, overdue reviews and rejected SIPs to recover.",
    widgets: [
      { widgetKey: "kpi_overdue_reviews" },
      { widgetKey: "kpi_open_tasks" },
      { widgetKey: "table_open_complaints" },
      { widgetKey: "table_review_pending" },
      { widgetKey: "table_sip_rejected" },
    ],
  },
  {
    key: "operations_queue",
    name: "Operations Queue",
    description: "Ops work list: tasks, SIP rejections, dormant clients and reviews due.",
    widgets: [
      { widgetKey: "kpi_open_tasks" },
      { widgetKey: "kpi_overdue_reviews" },
      { widgetKey: "table_sip_rejected" },
      { widgetKey: "table_review_pending" },
      { widgetKey: "table_dormant" },
    ],
  },
];

export const BOARD_TEMPLATE_BY_KEY: Record<string, BoardTemplate> = Object.fromEntries(
  BOARD_TEMPLATES.map((t) => [t.key, t])
);

let _seq = 0;
const tid = () => `w_${(_seq++).toString(36)}${Date.now().toString(36).slice(-4)}`;

/** Expand a template into a concrete layout, filling sizes from the catalog and
 *  dropping any widget key that isn't in the catalog (defensive). */
export function templateToLayout(template: BoardTemplate): PlacedWidget[] {
  const out: PlacedWidget[] = [];
  for (const w of template.widgets) {
    const meta = WIDGET_META_BY_KEY[w.widgetKey];
    if (!meta) continue;
    out.push({
      id: tid(),
      widgetKey: w.widgetKey,
      colSpan: w.colSpan ?? meta.defaultColSpan,
      rowSpan: w.rowSpan ?? meta.defaultRowSpan,
      title: w.title,
    });
  }
  return out;
}
