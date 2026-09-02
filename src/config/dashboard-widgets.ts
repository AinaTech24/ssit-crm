/**
 * Dashboard widget access catalog — the single source of truth for *which
 * dashboard home cards/sections* an MFD (admin → tenant) can see.
 *
 * Mirrors the widget blocks rendered by the MFD Owner cockpit
 * (src/components/dashboards/OwnerCockpit.tsx). Each entry is keyed by a stable
 * widget key. KEEP IN SYNC when dashboard widgets are added/removed.
 *
 * Gating model:
 *   subscriptions.allowed_dashboard_widgets
 *     - null  → ALL widgets visible (default; new firms see everything)
 *     - array → EXACTLY these widget keys are visible; everything else hidden
 *
 * Unlike the sidebar nav catalog there is no per-module default — dashboard
 * widgets aren't tied to plan modules, so the rule is simply "null = all,
 * array = exactly these".
 */

export type DashboardWidget = { key: string; label: string };
export type DashboardWidgetGroup = { title: string; items: DashboardWidget[] };

export const DASHBOARD_WIDGET_GROUPS: DashboardWidgetGroup[] = [
  {
    title: "Headline KPIs",
    items: [
      { key: "kpi.total_clients", label: "Total Clients" },
      { key: "kpi.open_leads", label: "Open Leads" },
      { key: "kpi.active_sip_book", label: "Active SIP Book" },
      { key: "kpi.net_business", label: "Net Business (MTD)" },
    ],
  },
  {
    title: "Business breakdown",
    items: [
      { key: "kpi.sip_added", label: "SIP Added" },
      { key: "kpi.lumpsum", label: "Lumpsum" },
      { key: "kpi.redemption", label: "Redemption" },
      { key: "kpi.sip_rejected", label: "SIP Rejected" },
      { key: "kpi.sip_stopped", label: "SIP Stopped" },
    ],
  },
  {
    title: "Growth & health",
    items: [
      { key: "section.firm_brief", label: "Daily brief strip (Today …)" },
      { key: "section.getting_started", label: "Getting-started checklist" },
      { key: "section.growth_retention", label: "Growth & Retention (churn / tax / referrals / circulars)" },
      { key: "section.top_movers", label: "Top movers" },
      { key: "section.data_gaps", label: "Data gaps to fix" },
      { key: "section.attention_queues", label: "Attention queues" },
      { key: "section.team_health", label: "Team & health" },
    ],
  },
  {
    title: "Analytics & charts",
    items: [
      { key: "section.lead_funnel", label: "Lead conversion funnel" },
      { key: "section.aum_segment", label: "AUM by segment" },
      { key: "section.rm_leaderboard", label: "RM leaderboard" },
      { key: "section.net_sales", label: "Net-sales chart" },
      { key: "section.trail_income", label: "Trail income" },
      { key: "section.sip_persistency", label: "SIP persistency" },
      { key: "section.owner_insights", label: "Owner insights (service & scaling)" },
    ],
  },
];

export const ALL_DASHBOARD_WIDGETS: DashboardWidget[] = DASHBOARD_WIDGET_GROUPS.flatMap(
  (g) => g.items
);

const WIDGET_KEY_SET = new Set<string>(ALL_DASHBOARD_WIDGETS.map((w) => w.key));

/** Validate a stored grant — every key must be a known widget (null = "all"). */
export function areKnownWidgetKeys(keys: string[] | null | undefined): boolean {
  if (!keys) return true;
  return keys.every((k) => WIDGET_KEY_SET.has(k));
}

/**
 * Is a given dashboard widget visible for this tenant?
 *   allowed == null  → everything visible (default)
 *   allowed == array → only keys present in the array are visible
 */
export function isDashboardWidgetVisible(
  allowed: string[] | null | undefined,
  key: string
): boolean {
  if (allowed == null) return true;
  return allowed.includes(key);
}
