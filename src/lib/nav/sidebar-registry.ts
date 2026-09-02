/**
 * Flat registry of every sidebar item (href + label + group), so platform
 * Module Controls can toggle ANY sidebar entry — including the ones that have no
 * package `module` key. Keep in sync with the NAV array in
 * `src/app/dashboard/layout.tsx` (same hrefs); a new nav item simply isn't
 * controllable here until it's added.
 *
 * Module Controls key on `href`; the dashboard layout filters / beta-tags its
 * NAV items by the same href.
 */
export type SidebarEntry = { group: string; href: string; label: string };

export const SIDEBAR_REGISTRY: SidebarEntry[] = [
  // Dashboards — the whole module. Disabling "/dashboard" here hides the entire
  // Dashboards dropdown for every tenant (layout kills the dropdown when the
  // "/dashboard" module control is 'disabled'); the others gate each sub-item.
  { group: "Dashboards", href: "/dashboard", label: "Dashboards (all)" },
  { group: "Dashboards", href: "/dashboard/boards", label: "My Dashboards" },
  { group: "Dashboards", href: "/dashboard/team", label: "Team Dashboard" },
  { group: "Dashboards", href: "/dashboard/team/scorecard", label: "Team Scorecard" },
  // General
  { group: "General", href: "/dashboard/command-center", label: "Command Center" },
  { group: "General", href: "/dashboard/next-best-action", label: "Next Best Action" },
  { group: "General", href: "/dashboard/tasks", label: "Tasks" },
  { group: "General", href: "/dashboard/service-requests", label: "Service Requests" },
  { group: "General", href: "/dashboard/tasks/daily", label: "Daily Tracker" },
  { group: "General", href: "/dashboard/review-meetings", label: "Meetings" },
  { group: "General", href: "/dashboard/calendar", label: "Calendar" },
  { group: "General", href: "/dashboard/attendance", label: "Attendance" },
  { group: "General", href: "/dashboard/trash", label: "Trash" },
  // CRM
  { group: "CRM", href: "/dashboard/leads", label: "Leads" },
  { group: "CRM", href: "/dashboard/investors", label: "Clients" },
  { group: "CRM", href: "/dashboard/families", label: "Family Mapping" },
  { group: "CRM", href: "/dashboard/risk-profiles", label: "Risk Profile" },
  { group: "CRM", href: "/dashboard/discovery", label: "Client Discovery" },
  { group: "CRM", href: "/dashboard/calculators", label: "Calculators" },
  { group: "CRM", href: "/dashboard/goals", label: "Goal Planning" },
  { group: "CRM", href: "/dashboard/proposals", label: "Proposals" },
  { group: "CRM", href: "/dashboard/financial-plans", label: "Financial Plans" },
  { group: "CRM", href: "/dashboard/insurance", label: "Insurance Policies" },
  { group: "CRM", href: "/dashboard/insurance-claims", label: "Insurance Claims" },
  { group: "CRM", href: "/dashboard/insurance/renewals", label: "Insurance Renewals" },
  { group: "CRM", href: "/dashboard/insurance/protection-gap", label: "Protection-Gap Radar" },
  { group: "CRM", href: "/dashboard/insurance/commission", label: "Insurance Commission" },
  // Operations
  { group: "Operations", href: "/dashboard/transactions", label: "MF Transactions" },
  { group: "Operations", href: "/dashboard/business-entries", label: "Business Entries" },
  { group: "Operations", href: "/dashboard/rta-imports", label: "RTA File Imports" },
  { group: "Operations", href: "/dashboard/reconciliation", label: "Reconciliation" },
  { group: "Operations", href: "/dashboard/sips", label: "SIP Tracker" },
  { group: "Operations", href: "/dashboard/sip-rejections", label: "SIP Rejections" },
  { group: "Operations", href: "/dashboard/sips/at-risk", label: "SIP At-Risk" },
  { group: "Operations", href: "/dashboard/activities", label: "Activity Log" },
  // Automation
  { group: "Automation", href: "/dashboard/workflows/rules", label: "Workflow Rules" },
  { group: "Automation", href: "/dashboard/workflows/actions", label: "Workflow Actions" },
  { group: "Automation", href: "/dashboard/workflows/runs", label: "Automation Monitor" },
  { group: "Automation", href: "/dashboard/templates", label: "Templates" },
  { group: "Automation", href: "/dashboard/campaigns", label: "Marketing Campaigns" },
  { group: "Automation", href: "/dashboard/ssit-library", label: "SSIT Content Library" },
  { group: "Automation", href: "/dashboard/communications", label: "Communications" },
  // Compliance & Team
  { group: "Compliance & Team", href: "/dashboard/compliance/command-center", label: "Compliance Center" },
  { group: "Compliance & Team", href: "/dashboard/compliance", label: "DDQ Readiness" },
  { group: "Compliance & Team", href: "/dashboard/compliance/amfi-circulars", label: "Circular Digest" },
  { group: "Compliance & Team", href: "/dashboard/reports/nomination-tracker", label: "Nomination Tracker" },
  { group: "Compliance & Team", href: "/dashboard/documents", label: "Documents" },
  { group: "Compliance & Team", href: "/dashboard/sops", label: "SOP Library" },
  { group: "Compliance & Team", href: "/dashboard/announcements", label: "Announcements" },
  { group: "Compliance & Team", href: "/dashboard/duplicates", label: "Find Duplicates" },
  { group: "Compliance & Team", href: "/dashboard/employees", label: "Employees" },
  { group: "Compliance & Team", href: "/dashboard/induction", label: "Induction" },
  { group: "Compliance & Team", href: "/dashboard/leave-applications", label: "Leave Applications" },
  { group: "Compliance & Team", href: "/dashboard/sub-distributors", label: "Sub-Distributors" },
  { group: "Compliance & Team", href: "/dashboard/legal-registrations", label: "Legal Registrations" },
  { group: "Compliance & Team", href: "/dashboard/amc-empanelments", label: "AMC Empanelments" },
  { group: "Compliance & Team", href: "/dashboard/schemes", label: "Scheme Master" },
  { group: "Compliance & Team", href: "/dashboard/product-offerings", label: "Products & Services" },
  // Insights
  { group: "Insights", href: "/dashboard/reports", label: "Reports & MIS" },
  { group: "Insights", href: "/dashboard/reports/trail-forecast", label: "Trail Forecast" },
  { group: "Insights", href: "/dashboard/portfolio-intelligence", label: "Portfolio Intelligence" },
  { group: "Insights", href: "/dashboard/reports/churn-risk", label: "Churn-risk Radar" },
  { group: "Insights", href: "/dashboard/reports/tax-harvesting", label: "Tax-Harvesting" },
  { group: "Insights", href: "/dashboard/reports/cross-sell", label: "Cross-sell Radar" },
  { group: "Insights", href: "/dashboard/commission-reconciliation", label: "Commission Reconciliation" },
  { group: "Insights", href: "/dashboard/finances", label: "Practice Finances" },
  { group: "Insights", href: "/dashboard/ai-assistant", label: "AI Assistant" },
  { group: "Insights", href: "/dashboard/audit-log", label: "Audit Log" },
];
