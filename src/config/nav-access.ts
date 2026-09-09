/**
 * Sidebar access catalog — the single source of truth for *which sidebar items*
 * an MFD (admin → tenant) and a team member (MFD → user) can open.
 *
 * Mirrors the NAV array in src/app/dashboard/layout.tsx. Each entry is keyed by
 * the item's href (stable + unique). KEEP IN SYNC when nav items are added.
 *
 * "Core" items (Dashboard, Billing, Firm Profile, Settings, Help) are always
 * accessible and are intentionally excluded from the catalog so an owner can
 * never accidentally lock a firm out of billing/settings.
 *
 * Gating model (dashboard layout):
 *   role gate  →  tenant nav grant (admin → MFD)  →  user nav grant (MFD → team)
 *
 *   tenant grant: subscriptions.allowed_nav  (null = the package-module default)
 *   user grant:   users.enabled_modules       (null = inherit the tenant's set)
 *                 — owners always get the full tenant set.
 */

export type NavAccessItem = { key: string; label: string; module?: string };
export type NavAccessGroup = { title: string; items: NavAccessItem[] };

export const NAV_ACCESS_GROUPS: NavAccessGroup[] = [
  {
    // The whole Dashboards module. Grouped on its own so an admin can disable the
    // entire module for a tenant / user / package with one "Disable all" click.
    // (No `module` key — these stay granted by default under coarse package
    // gating; an explicit grant is what turns them off.)
    title: "Dashboards",
    items: [
      { key: "/dashboard/boards", label: "My Dashboards" },
      { key: "/dashboard/team", label: "Team Dashboard" },
      { key: "/dashboard/team/scorecard", label: "Team Scorecard" },
    ],
  },
  {
    title: "General",
    items: [
      { key: "/dashboard/command-center", label: "Command Center" },
      { key: "/dashboard/next-best-action", label: "Next Best Action" },
      { key: "/dashboard/tasks", label: "Tasks", module: "tasks" },
      { key: "/dashboard/activity-tracker", label: "Activity Tracker" },
      { key: "/dashboard/research-tracker", label: "Daily Activity Tracker" },
      { key: "/dashboard/review-meetings", label: "Meetings", module: "review_meetings" },
      { key: "/dashboard/calendar", label: "Calendar" },
      { key: "/dashboard/attendance", label: "Attendance" },
      { key: "/dashboard/trash", label: "Trash" },
    ],
  },
  {
    title: "CRM",
    items: [
      { key: "/dashboard/pipeline-board", label: "Pipeline Board", module: "lead_management" },
      { key: "/dashboard/leads", label: "Leads", module: "lead_management" },
      { key: "/dashboard/investors", label: "Clients", module: "client_master" },
      { key: "/dashboard/families", label: "Family Mapping", module: "family_mapping" },
      { key: "/dashboard/referrals", label: "Referrals", module: "client_master" },
      { key: "/dashboard/risk-profiles", label: "Risk Profile", module: "risk_profile" },
      { key: "/dashboard/discovery", label: "Discovery & Suitability" },
      { key: "/dashboard/calculators", label: "Calculators" },
      { key: "/dashboard/goals", label: "Goal Planning", module: "goal_planning" },
      { key: "/dashboard/proposals", label: "Proposals", module: "proposals" },
      { key: "/dashboard/financial-plans", label: "Financial Plans", module: "goal_planning" },
      { key: "/dashboard/insurance", label: "Insurance Policies", module: "insurance" },
      { key: "/dashboard/insurance-claims", label: "Insurance Claims", module: "insurance" },
      { key: "/dashboard/insurance/renewals", label: "Insurance Renewals", module: "insurance" },
      { key: "/dashboard/insurance/protection-gap", label: "Protection-Gap Radar", module: "insurance" },
      { key: "/dashboard/insurance/commission", label: "Insurance Commission", module: "insurance" },
    ],
  },
  {
    title: "Operations",
    items: [
      { key: "/dashboard/business-entries", label: "Business Entries", module: "business_entries" },
      { key: "/dashboard/transactions", label: "MF Transactions", module: "transactions" },
      { key: "/dashboard/rta-imports", label: "RTA File Imports", module: "transactions" },
      { key: "/dashboard/reconciliation", label: "Reconciliation", module: "transactions" },
      { key: "/dashboard/sips", label: "SIP Tracker", module: "sip_tracker" },
      { key: "/dashboard/sip-rejections", label: "SIP Rejections", module: "sip_rejection" },
      { key: "/dashboard/sips/at-risk", label: "SIP At-Risk", module: "sip_tracker" },
      { key: "/dashboard/activities", label: "Activity Log" },
      { key: "/dashboard/service-requests", label: "Service Requests", module: "service_requests" },
      { key: "/dashboard/complaints", label: "Complaints", module: "complaints" },
    ],
  },
  {
    title: "Automation",
    items: [
      { key: "/dashboard/workflows/rules", label: "Workflow Rules", module: "automation_workflows" },
      { key: "/dashboard/workflows/actions", label: "Workflow Actions", module: "automation_workflows" },
      { key: "/dashboard/workflows/runs", label: "Automation Monitor", module: "automation_workflows" },
      { key: "/dashboard/templates", label: "Templates", module: "broadcasts" },
      { key: "/dashboard/campaigns", label: "Marketing Campaigns", module: "marketing_campaigns" },
      { key: "/dashboard/ssit-library", label: "Equitywala Content Library" },
      { key: "/dashboard/communications", label: "Communications", module: "broadcasts" },
    ],
  },
  {
    title: "Compliance & Team",
    items: [
      { key: "/dashboard/compliance/command-center", label: "Compliance Center" },
      { key: "/dashboard/compliance", label: "DDQ Readiness", module: "ddq" },
      { key: "/dashboard/compliance/amfi-circulars", label: "Circular Digest" },
      { key: "/dashboard/reports/nomination-tracker", label: "Nomination Tracker" },
      { key: "/dashboard/documents", label: "Documents", module: "documents" },
      { key: "/dashboard/sops", label: "SOP Library" },
      { key: "/dashboard/announcements", label: "Announcements" },
      { key: "/dashboard/duplicates", label: "Find Duplicates" },
      { key: "/dashboard/employees", label: "Employees / Team", module: "employees" },
      { key: "/dashboard/leave-applications", label: "Leave Applications" },
      { key: "/dashboard/sub-distributors", label: "Sub-Distributors" },
      { key: "/dashboard/legal-registrations", label: "Legal Registrations" },
      { key: "/dashboard/amc-empanelments", label: "AMC Empanelments" },
      { key: "/dashboard/schemes", label: "Scheme Master" },
      { key: "/dashboard/product-offerings", label: "Products & Services" },
    ],
  },
  {
    title: "Insights",
    items: [
      { key: "/dashboard/reports", label: "Reports & MIS", module: "reports" },
      { key: "/dashboard/reports/trail-forecast", label: "Trail Forecast" },
      { key: "/dashboard/portfolio-intelligence", label: "Portfolio Intelligence" },
      { key: "/dashboard/reports/churn-risk", label: "Churn-risk Radar" },
      { key: "/dashboard/reports/tax-harvesting", label: "Tax-Harvesting" },
      { key: "/dashboard/reports/cross-sell", label: "Cross-sell Radar" },
      { key: "/dashboard/commission-reconciliation", label: "Commission Reconciliation", module: "reports" },
      { key: "/dashboard/finances", label: "Practice Finances", module: "reports" },
      { key: "/dashboard/ai-assistant", label: "AI Assistant", module: "ai_assistant" },
      { key: "/dashboard/audit-log", label: "Audit Log", module: "audit_log" },
    ],
  },
];

/**
 * Per-role DEFAULT sidebar, applied ONLY when a user has no explicit
 * `users.enabled_modules` grant. It narrows what a role SEES; it does not
 * revoke capabilities — those stay in the RBAC matrix so a firm admin can widen
 * any individual back-office user by ticking "Customize sidebar access" on their
 * employee record. That is the whole point: scoped by default, manageable
 * per person.
 *
 * A role that is absent from this map is unrestricted, and a user holding ANY
 * unrestricted role is unrestricted (see roleDefaultNavKeys) — so a back-office
 * employee who is also an RM keeps the full RM sidebar.
 */
export const ROLE_DEFAULT_NAV: Record<string, string[]> = {
  // Marketing works two things: the tasks RMs assign them, and the log of what
  // they produced. Explicitly NOT the CRM — no clients, leads or pipeline.
  // Attendance, leave and announcements stay because every employee needs their
  // own HR self-service whatever desk they sit at.
  marketing: [
    "/dashboard/tasks",
    "/dashboard/activity-tracker",
    "/dashboard/attendance",
    "/dashboard/leave-applications",
    "/dashboard/announcements",
  ],
  // Research: the same shape, with the research log instead.
  ra_research: [
    "/dashboard/tasks",
    "/dashboard/research-tracker",
    "/dashboard/attendance",
    "/dashboard/leave-applications",
    "/dashboard/announcements",
  ],
  // Back office works five areas, per the firm policy:
  //   clients (view) · tasks · service requests · business entries · SIP rejections
  // The trailing four are employee self-service — every staff member needs to
  // see their own calendar, mark attendance, apply for leave and read notices,
  // whatever desk they sit at.
  back_office: [
    "/dashboard/investors",
    "/dashboard/tasks",
    "/dashboard/service-requests",
    "/dashboard/business-entries",
    "/dashboard/sip-rejections",
    "/dashboard/calendar",
    "/dashboard/attendance",
    "/dashboard/leave-applications",
    "/dashboard/announcements",
  ],
};

/**
 * The default nav grant for a set of roles, or null for "no default — show
 * everything the tenant allows". Returns null the moment the user holds a role
 * with no entry above, so adding a second role can only ever widen access.
 */
export function roleDefaultNavKeys(roles: string[]): string[] | null {
  if (!roles.length) return null;
  if (roles.some((r) => !ROLE_DEFAULT_NAV[r])) return null;
  const keys = new Set<string>();
  for (const r of roles) for (const k of ROLE_DEFAULT_NAV[r]) keys.add(k);
  return keys.size ? [...keys] : null;
}

/** Never gated — always accessible regardless of grants. */
export const CORE_HREFS = new Set<string>([
  "/dashboard",
  "/dashboard/settings/firm-profile",
  "/dashboard/settings",
  "/dashboard/help",
]);

export const ALL_NAV_ITEMS: NavAccessItem[] = NAV_ACCESS_GROUPS.flatMap((g) => g.items);
const NAV_KEY_SET = new Set<string>(ALL_NAV_ITEMS.map((i) => i.key));

/** Is this href a catalog (gatable) sidebar item? */
export function isGatableNav(href: string): boolean {
  return NAV_KEY_SET.has(href);
}

/** Validate a stored grant — every key must be a known nav item (null = "all"). */
export function areKnownNavKeys(keys: string[] | null | undefined): boolean {
  if (!keys) return true;
  return keys.every((k) => NAV_KEY_SET.has(k));
}

/**
 * The sidebar hrefs a TENANT can access. Resolution order (first that applies):
 *   1. explicit admin grant — subscriptions.allowed_nav
 *   2. package GRANULAR feature set — packages.enabled_features (per-feature
 *      Off/Included chosen in the Equitywala package editor)
 *   3. package COARSE module default (legacy) — items with no module, or whose
 *      module the package enables (the original `i.module` sidebar gate)
 *
 * Granular takes precedence over coarse so a package edited in the new
 * all-65-features editor controls the sidebar exactly; packages never touched
 * since the granular rollout keep their existing coarse behaviour unchanged.
 */
export function tenantAccessibleNavKeys(opts: {
  allowedNav: string[] | null;
  enabledModules: string[];
  enabledFeatures?: string[] | null;
}): string[] {
  if (opts.allowedNav) return opts.allowedNav.filter((k) => NAV_KEY_SET.has(k));
  if (opts.enabledFeatures && opts.enabledFeatures.length > 0) {
    return opts.enabledFeatures.filter((k) => NAV_KEY_SET.has(k));
  }
  const modSet = new Set(opts.enabledModules);
  const noGating = modSet.size === 0; // demo/dev with no package = allow all
  return ALL_NAV_ITEMS.filter((i) => !i.module || noGating || modSet.has(i.module)).map((i) => i.key);
}

/**
 * The granular included-feature list equivalent to a coarse `enabledModules`
 * set — every always-on item (no module) plus every item whose module is
 * enabled. Used to PRE-FILL the granular editor for a legacy package and as the
 * gating fallback. Mirrors the coarse branch of `tenantAccessibleNavKeys`.
 */
export function defaultFeaturesForModules(enabledModules: string[]): string[] {
  const modSet = new Set(enabledModules);
  const noGating = modSet.size === 0;
  return ALL_NAV_ITEMS.filter((i) => !i.module || noGating || modSet.has(i.module)).map((i) => i.key);
}

/**
 * Derive the coarse module set implied by a granular feature list — a module
 * is "on" if at least one of its features is included. Lets us keep
 * packages.enabled_modules (consumed by hasModule() feature checks) in sync
 * when a package is saved granularly.
 */
export function coarseModulesFromFeatures(features: string[]): string[] {
  const keySet = new Set(features);
  const mods = new Set<string>();
  for (const item of ALL_NAV_ITEMS) {
    if (item.module && keySet.has(item.key)) mods.add(item.module);
  }
  return [...mods];
}

/**
 * The gatable sidebar key that `pathname` belongs to — exact match or as a path
 * prefix (e.g. /dashboard/investors/123 → /dashboard/investors) — or null for a
 * core/un-gated route. Lets the dashboard layout ENFORCE nav access on direct
 * navigation, not merely hide the sidebar item (audit: UI-only gating bypass).
 */
export function gatedNavKeyForPath(pathname: string): string | null {
  if (!pathname || CORE_HREFS.has(pathname)) return null;
  let best: string | null = null;
  for (const key of NAV_KEY_SET) {
    if (pathname === key || pathname.startsWith(key + "/")) {
      if (!best || key.length > best.length) best = key; // longest (most specific) match
    }
  }
  return best;
}
