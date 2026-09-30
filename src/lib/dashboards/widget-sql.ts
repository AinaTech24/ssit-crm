/**
 * Widget SQL + per-type view config — SERVER ONLY (imported by the widget data
 * API route). Each entry: a `run(sql, ctx)` that builds a parameterized query +
 * a `view` describing how to render the rows. Keep keys in sync with widgets.ts.
 *
 * `ctx.rmId` (validated uuid) optionally scopes a widget to one RM. Only widgets
 * with a natural RM column apply it.
 */

import { sql } from "drizzle-orm";

export type WidgetView =
  | { kind: "kpi"; valueKey: string; format: "inr" | "number" | "pct" }
  | { kind: "chart"; x: string; series: { key: string; label: string }[]; format?: "inr" | "number" }
  | { kind: "donut"; labelKey: string; valueKey: string; format?: "inr" | "number" }
  | { kind: "funnel"; labelKey: string; valueKey: string }
  | { kind: "meter"; valueKey: string; targetKey: string; format: "inr" | "number" }
  | { kind: "comparator"; currentKey: string; previousKey: string; format: "inr" | "number" }
  | { kind: "table"; columns: { key: string; label: string; format?: "inr" | "date" | "number" | "pct" }[] };

export interface WidgetSqlDef {
  view: WidgetView;
  run: (s: typeof sql, ctx: { rmId?: string }) => any;
}

const rmInvestor = (rmId?: string) => (rmId ? sql`AND i.rm_id = ${rmId}::uuid` : sql``);
const rmInvestorBare = (rmId?: string) => (rmId ? sql`AND rm_id = ${rmId}::uuid` : sql``);
const rmLead = (rmId?: string) => (rmId ? sql`AND owner_id = ${rmId}::uuid` : sql``);
const rmTask = (rmId?: string) => (rmId ? sql`AND assignee_id = ${rmId}::uuid` : sql``);

/**
 * Net-business value of one business_entry_lines row `l`: positive for fresh
 * purchases (SIP / lumpsum / additional purchase), negative for redemptions &
 * SWP, and zero for internal switches/STP (not fresh money). Reused by the
 * net-sales widgets so they read the Transactions ledger, not the RTA feed.
 */
const BE_NET = sql`CASE WHEN l.txn_type IN ('sip','sip_topup','lumpsum','additional_purchase') THEN l.amount::numeric WHEN l.txn_type IN ('redemption','swp') THEN -l.amount::numeric ELSE 0 END`;

export const WIDGET_SQL: Record<string, WidgetSqlDef> = {
  // ── KPIs ──────────────────────────────────────────────────────────────
  kpi_aum: {
    view: { kind: "kpi", valueKey: "value", format: "inr" },
    run: (s, c) => s`SELECT COALESCE(SUM(aum::numeric),0)::numeric AS value FROM investors WHERE status='active' AND deleted_at IS NULL ${rmInvestorBare(c.rmId)}`,
  },
  kpi_net_sales_mtd: {
    view: { kind: "kpi", valueKey: "value", format: "inr" },
    // Net business from the Transactions ledger (what the firm actually
    // books), not the RTA transactions feed: inflow (SIP + lumpsum + additional
    // purchase) minus outflow (redemption + SWP), this month, excluding drafts'
    // siblings only by way of cancelled entries.
    run: (s) => s`SELECT COALESCE(SUM(${BE_NET}),0)::numeric AS value
      FROM business_entry_lines l JOIN business_entries e ON e.id = l.entry_id
      WHERE e.status <> 'cancelled' AND e.business_date >= date_trunc('month', now())::date`,
  },
  kpi_gross_business_mtd: {
    view: { kind: "kpi", valueKey: "value", format: "inr" },
    // Gross booked business (all purchase legs) this month, from Transactions.
    run: (s) => s`SELECT COALESCE(SUM(l.amount::numeric) FILTER (WHERE l.txn_type IN ('sip','sip_topup','lumpsum','additional_purchase','switch','stp')),0)::numeric AS value
      FROM business_entry_lines l JOIN business_entries e ON e.id = l.entry_id
      WHERE e.status <> 'cancelled' AND e.business_date >= date_trunc('month', now())::date`,
  },
  kpi_active_sip: {
    view: { kind: "kpi", valueKey: "value", format: "inr" },
    run: (s, c) => s`SELECT COALESCE(SUM(active_sip_amount::numeric),0)::numeric AS value FROM investors WHERE status='active' AND deleted_at IS NULL ${rmInvestorBare(c.rmId)}`,
  },
  kpi_clients: {
    view: { kind: "kpi", valueKey: "value", format: "number" },
    run: (s, c) => s`SELECT COUNT(*)::int AS value FROM investors WHERE status='active' AND deleted_at IS NULL ${rmInvestorBare(c.rmId)}`,
  },
  kpi_new_leads_mtd: {
    view: { kind: "kpi", valueKey: "value", format: "number" },
    run: (s, c) => s`SELECT COUNT(*)::int AS value FROM leads WHERE created_at >= date_trunc('month', now()) ${rmLead(c.rmId)}`,
  },
  kpi_conversion_rate: {
    view: { kind: "kpi", valueKey: "value", format: "pct" },
    run: (s, c) => s`SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE converted_investor_id IS NOT NULL) / NULLIF(COUNT(*),0), 1) AS value
      FROM leads WHERE 1=1 ${rmLead(c.rmId)}`,
  },
  kpi_open_tasks: {
    view: { kind: "kpi", valueKey: "value", format: "number" },
    run: (s, c) => s`SELECT COUNT(*)::int AS value FROM tasks WHERE status IN ('open','in_progress') ${rmTask(c.rmId)}`,
  },
  kpi_overdue_reviews: {
    view: { kind: "kpi", valueKey: "value", format: "number" },
    run: (s, c) => s`SELECT COUNT(*)::int AS value FROM investors WHERE status='active' AND deleted_at IS NULL AND next_review_at IS NOT NULL AND next_review_at < now() ${rmInvestorBare(c.rmId)}`,
  },

  // ── Charts ────────────────────────────────────────────────────────────
  chart_net_sales: {
    view: { kind: "chart", x: "label", series: [{ key: "net", label: "Net" }], format: "inr" },
    // Daily net business from the Transactions ledger — last 30 days.
    run: (s) => s`SELECT to_char(e.business_date,'DD Mon') AS label, e.business_date AS d,
      COALESCE(SUM(${BE_NET}),0)::numeric AS net
      FROM business_entry_lines l JOIN business_entries e ON e.id = l.entry_id
      WHERE e.status <> 'cancelled' AND e.business_date >= (now() - interval '30 days')::date
      GROUP BY e.business_date ORDER BY e.business_date`,
  },
  chart_business_by_product: {
    view: { kind: "donut", labelKey: "label", valueKey: "value", format: "inr" },
    // Business mix by product type (MF / PMS / AIF / …) — last 90 days, from
    // the Transactions ledger.
    run: (s) => s`SELECT e.product_type AS label,
      COALESCE(SUM(l.amount::numeric) FILTER (WHERE l.txn_type IN ('sip','sip_topup','lumpsum','additional_purchase','switch','stp')),0)::numeric AS value
      FROM business_entry_lines l JOIN business_entries e ON e.id = l.entry_id
      WHERE e.status <> 'cancelled' AND e.business_date >= (now() - interval '90 days')::date
      GROUP BY e.product_type ORDER BY value DESC`,
  },
  chart_aum_movement: {
    view: { kind: "chart", x: "label", series: [{ key: "inflow", label: "Inflow" }, { key: "outflow", label: "Outflow" }], format: "inr" },
    run: (s) => s`SELECT to_char(date_trunc('month', order_date),'Mon') AS label, date_trunc('month', order_date) AS d,
      COALESCE(SUM(CASE WHEN direction='inflow' THEN amount::numeric ELSE 0 END),0)::numeric AS inflow,
      COALESCE(SUM(CASE WHEN direction='outflow' THEN amount::numeric ELSE 0 END),0)::numeric AS outflow
      FROM transactions WHERE status IN ('successful','processed') AND order_date >= date_trunc('month', now()) - interval '11 months'
      GROUP BY date_trunc('month', order_date) ORDER BY date_trunc('month', order_date)`,
  },
  chart_amc_business: {
    view: { kind: "chart", x: "label", series: [{ key: "net", label: "Net" }], format: "inr" },
    run: (s) => s`SELECT COALESCE(amc_name, amc_code, '—') AS label,
      COALESCE(SUM(CASE WHEN direction='inflow' THEN amount::numeric ELSE -amount::numeric END),0)::numeric AS net
      FROM transactions WHERE status IN ('successful','processed') AND order_date >= now() - interval '90 days'
      GROUP BY 1 ORDER BY net DESC LIMIT 10`,
  },
  chart_scheme_category: {
    view: { kind: "donut", labelKey: "label", valueKey: "value", format: "inr" },
    run: (s) => s`SELECT COALESCE(scheme_category, '—') AS label,
      COALESCE(SUM(CASE WHEN direction='inflow' THEN amount::numeric ELSE 0 END),0)::numeric AS value
      FROM transactions WHERE status IN ('successful','processed') AND order_date >= now() - interval '90 days'
      GROUP BY 1 ORDER BY value DESC LIMIT 8`,
  },

  // ── Comparator + Target meter ─────────────────────────────────────────
  cmp_net_sales_mom: {
    view: { kind: "comparator", currentKey: "cur", previousKey: "prev", format: "inr" },
    // This month vs last month net business, from the Transactions ledger.
    run: (s) => s`SELECT
      COALESCE(SUM(CASE WHEN e.business_date >= date_trunc('month', now())::date THEN (${BE_NET}) ELSE 0 END),0)::numeric AS cur,
      COALESCE(SUM(CASE WHEN e.business_date >= (date_trunc('month', now()) - interval '1 month')::date AND e.business_date < date_trunc('month', now())::date THEN (${BE_NET}) ELSE 0 END),0)::numeric AS prev
      FROM business_entry_lines l JOIN business_entries e ON e.id = l.entry_id
      WHERE e.status <> 'cancelled' AND e.business_date >= (date_trunc('month', now()) - interval '1 month')::date`,
  },
  cmp_new_clients_mom: {
    view: { kind: "comparator", currentKey: "cur", previousKey: "prev", format: "number" },
    run: (s) => s`SELECT
      COUNT(*) FILTER (WHERE onboarded_at >= date_trunc('month', now()))::int AS cur,
      COUNT(*) FILTER (WHERE onboarded_at >= date_trunc('month', now()) - interval '1 month' AND onboarded_at < date_trunc('month', now()))::int AS prev
      FROM investors WHERE deleted_at IS NULL AND onboarded_at >= date_trunc('month', now()) - interval '1 month'`,
  },
  meter_new_clients_target: {
    view: { kind: "meter", valueKey: "value", targetKey: "target", format: "number" },
    run: (s) => s`
      WITH fy AS (
        SELECT (CASE WHEN EXTRACT(MONTH FROM now()) >= 4 THEN date_trunc('year', now())
                     ELSE date_trunc('year', now()) - interval '1 year' END) + interval '3 months' AS fy_start,
               (CASE WHEN EXTRACT(MONTH FROM now()) >= 4 THEN EXTRACT(YEAR FROM now())::int
                     ELSE EXTRACT(YEAR FROM now())::int - 1 END) AS y
      )
      SELECT
        (SELECT COUNT(*)::int FROM investors WHERE deleted_at IS NULL AND onboarded_at >= (SELECT fy_start FROM fy)) AS value,
        COALESCE((SELECT annual_target::numeric FROM business_targets
                  WHERE metric='new_clients'
                    AND fiscal_year = ((SELECT y FROM fy)::text || '-' || lpad((((SELECT y FROM fy) + 1) % 100)::text, 2, '0'))
                  LIMIT 1), 0) AS target`,
  },

  // ── Funnel ────────────────────────────────────────────────────────────
  funnel_blueprint: {
    view: { kind: "funnel", labelKey: "label", valueKey: "value" },
    run: (s) => s`SELECT bs.stage_name AS label, COUNT(lsh.id)::int AS value
      FROM blueprint_stages bs
      JOIN blueprint_definitions bd ON bd.id = bs.blueprint_id AND bd.module_name='leads' AND bd.is_active=true
      LEFT JOIN lead_stage_history lsh ON lsh.stage_key = bs.stage_key
      WHERE bs.stage_order <= 12
      GROUP BY bs.stage_key, bs.stage_name, bs.stage_order ORDER BY bs.stage_order`,
  },

  // ── Tables ────────────────────────────────────────────────────────────
  table_high_aum: {
    view: { kind: "table", columns: [{ key: "name", label: "Client" }, { key: "segment_tag", label: "Segment" }, { key: "aum", label: "AUM", format: "inr" }] },
    run: (s, c) => s`SELECT name, segment_tag, aum FROM investors i WHERE status='active' AND i.deleted_at IS NULL ${rmInvestor(c.rmId)} ORDER BY aum::numeric DESC NULLS LAST LIMIT 12`,
  },
  table_dormant: {
    view: { kind: "table", columns: [{ key: "name", label: "Client" }, { key: "aum", label: "AUM", format: "inr" }, { key: "last_transaction_at", label: "Last txn", format: "date" }] },
    run: (s, c) => s`SELECT name, aum, last_transaction_at FROM investors i WHERE status='active' AND i.deleted_at IS NULL
      AND (last_transaction_at IS NULL OR last_transaction_at < now() - make_interval(days => COALESCE((SELECT dormancy_window_days FROM tenants WHERE id = i.tenant_id), 180))) ${rmInvestor(c.rmId)}
      ORDER BY last_transaction_at ASC NULLS FIRST LIMIT 12`,
  },
  table_review_pending: {
    view: { kind: "table", columns: [{ key: "name", label: "Client" }, { key: "next_review_at", label: "Review due", format: "date" }] },
    run: (s, c) => s`SELECT name, next_review_at FROM investors i WHERE status='active' AND i.deleted_at IS NULL AND next_review_at IS NOT NULL ${rmInvestor(c.rmId)}
      ORDER BY next_review_at ASC LIMIT 12`,
  },
  table_sla_leads: {
    view: { kind: "table", columns: [{ key: "name", label: "Lead" }, { key: "stage_name", label: "Stage" }, { key: "overdue_days", label: "Overdue (d)", format: "number" }] },
    run: (s) => s`SELECT l.name, bs.stage_name,
      ROUND(EXTRACT(EPOCH FROM (now() - lbi.stage_entered_at))/86400.0 - bs.sla_days, 1) AS overdue_days
      FROM lead_blueprint_instances lbi
      JOIN leads l ON l.id = lbi.lead_id
      JOIN blueprint_stages bs ON bs.blueprint_id = lbi.blueprint_id AND bs.stage_key = lbi.current_stage_key
      WHERE lbi.status='in_progress' AND bs.sla_days IS NOT NULL
        AND lbi.stage_entered_at + (bs.sla_days || ' days')::interval < now()
      ORDER BY overdue_days DESC LIMIT 12`,
  },
  table_sip_rejected: {
    view: { kind: "table", columns: [{ key: "name", label: "Client" }, { key: "scheme_name", label: "Scheme" }, { key: "amount", label: "Amount", format: "inr" }, { key: "reason_code", label: "Reason" }] },
    run: (s) => s`SELECT i.name, t.scheme_name, t.amount, t.reason_code
      FROM transactions t LEFT JOIN investors i ON i.id = t.investor_id
      WHERE t.type='sip' AND t.status='rejected' ORDER BY t.created_at DESC LIMIT 12`,
  },
  table_open_complaints: {
    view: { kind: "table", columns: [{ key: "ticket_no", label: "Ticket" }, { key: "investor_name", label: "Client" }, { key: "days_open", label: "Days open", format: "number" }] },
    run: (s) => s`SELECT sr.ticket_no, i.name AS investor_name, EXTRACT(DAY FROM now() - sr.created_at)::int AS days_open
      FROM service_requests sr LEFT JOIN investors i ON i.id = sr.investor_id
      WHERE sr.type='complaint' AND sr.status IN ('open','in_progress','escalated','waiting_customer')
      ORDER BY sr.created_at ASC LIMIT 12`,
  },
  table_rm_business: {
    view: { kind: "table", columns: [{ key: "rm_name", label: "RM" }, { key: "clients", label: "Clients", format: "number" }, { key: "aum", label: "AUM", format: "inr" }, { key: "sip_book", label: "SIP book", format: "inr" }] },
    run: (s) => s`SELECT u.name AS rm_name, COUNT(i.id)::int AS clients,
      COALESCE(SUM(i.aum::numeric),0)::numeric AS aum, COALESCE(SUM(i.active_sip_amount::numeric),0)::numeric AS sip_book
      FROM users u LEFT JOIN investors i ON i.rm_id = u.id AND i.status='active' AND i.deleted_at IS NULL
      WHERE 'rm' = ANY(u.roles) GROUP BY u.id, u.name ORDER BY aum DESC LIMIT 12`,
  },
};
