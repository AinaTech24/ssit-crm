/**
 * Platform-level constants.
 *
 * Equitywala operates a "platform tenant" — a sentinel tenant_id under which all
 * Equitywala staff users live. Platform admins have cross-tenant visibility (enforced
 * at the DB via RLS bypass for these users) but their own user records still
 * have a tenant_id (this sentinel) so they go through the normal auth flow.
 */

export const PLATFORM_TENANT_ID = "00000000-0000-0000-0000-000000000000";

/** Canonical Equitywala admin role names. `platform_admin` = "Super Admin",
 *  `platform_support` = "Admin". Both are FULL platform administrators. */
export const PLATFORM_ROLES = ["platform_admin", "platform_support"] as const;

export function isPlatformAdmin(roles: string[] | undefined): boolean {
  if (!roles?.length) return false;
  // Super Admin (platform_admin) AND Admin (platform_support) are both full
  // platform administrators with identical powers — they differ only in label.
  return roles.includes("platform_admin") || roles.includes("platform_support");
}

export function isPlatformStaff(roles: string[] | undefined): boolean {
  if (!roles?.length) return false;
  return roles.includes("platform_admin") || roles.includes("platform_support");
}

/**
 * The set of module keys the SaaS exposes. Packages enable a subset.
 * Keep in sync with packages.enabledModules + sidebar gating in dashboard layout.
 */
export const ALL_MODULES = [
  "crm",
  "dashboards",
  "business_entries",
  "lead_management",
  "client_master",
  "family_mapping",
  "onboarding",
  "risk_profile",
  "goal_planning",
  "proposals",
  "insurance",
  "transactions",
  "sip_tracker",
  "sip_rejection",
  "review_meetings",
  "service_requests",
  "complaints",
  "ddq",
  "marketing_campaigns",
  "tasks",
  "employees",
  "reports",
  "documents",
  "cybersecurity",
  "ai_assistant",
  "automation_workflows",
  "broadcasts",
  "white_label",
  "audit_log",
  "sub_distributor",
] as const;

export type ModuleKey = (typeof ALL_MODULES)[number];

/**
 * Human-friendly labels for each module key. Single source of truth for the
 * admin → MFD access control (super-admin) AND the MFD → team-member module
 * access UI (employee form). Grouped hint in parens mirrors the sidebar.
 */
export const MODULE_LABELS: Record<ModuleKey, string> = {
  crm: "CRM Dashboard",
  dashboards: "Dashboards",
  business_entries: "Business Entries",
  lead_management: "Leads",
  client_master: "Clients",
  family_mapping: "Family Mapping",
  onboarding: "Client Onboarding",
  risk_profile: "Risk Profiling",
  goal_planning: "Goal Planning",
  proposals: "Proposals",
  insurance: "Insurance",
  transactions: "MF Transactions",
  sip_tracker: "SIP Tracker",
  sip_rejection: "SIP Rejections",
  review_meetings: "Review Meetings",
  service_requests: "Service Requests",
  complaints: "Complaints",
  ddq: "DDQ Readiness",
  marketing_campaigns: "Marketing Campaigns",
  tasks: "Tasks",
  employees: "Employees / Team",
  reports: "Reports & MIS",
  documents: "Documents",
  cybersecurity: "Cybersecurity",
  ai_assistant: "AI Assistant",
  automation_workflows: "Workflows & Segments",
  broadcasts: "Templates & Communications",
  white_label: "White-Label Branding",
  audit_log: "Audit Log",
  sub_distributor: "Sub-Distributors",
};

const MODULE_SET = new Set<string>(ALL_MODULES as readonly string[]);

/** True iff every key in `mods` is a recognised module (or the list is null = "all"). */
export function areKnownModules(mods: string[] | null | undefined): boolean {
  if (!mods) return true;
  return mods.every((m) => MODULE_SET.has(m));
}

/** Default modules each preset package enables. */
export const PACKAGE_PRESETS: Record<string, { modules: ModuleKey[]; flags: Record<string, any> }> = {
  starter: {
    modules: [
      "crm",
      "dashboards",
      "business_entries",
      "lead_management",
      "client_master",
      "tasks",
      "service_requests",
      "transactions",
      "sip_tracker",
      "documents",
      "reports",
    ],
    flags: { ai_tier: "none", video: "none", broadcasts: false },
  },
  growth: {
    modules: [
      "crm",
      "dashboards",
      "business_entries",
      "lead_management",
      "client_master",
      "family_mapping",
      "onboarding",
      "risk_profile",
      "goal_planning",
      "tasks",
      "transactions",
      "sip_tracker",
      "sip_rejection",
      "review_meetings",
      "service_requests",
      "complaints",
      "ddq",
      "marketing_campaigns",
      "automation_workflows",
      "broadcasts",
      "documents",
      "reports",
      "employees",
    ],
    flags: { ai_tier: "tier1", video: "limited", broadcasts: true },
  },
  professional: {
    modules: [...ALL_MODULES.filter((m) => m !== "white_label" && m !== "sub_distributor")] as ModuleKey[],
    flags: { ai_tier: "tier2", video: "unlimited", broadcasts: true },
  },
  premium: {
    modules: [...ALL_MODULES] as ModuleKey[],
    flags: { ai_tier: "tier3", video: "unlimited", broadcasts: true, white_label: true },
  },
};
