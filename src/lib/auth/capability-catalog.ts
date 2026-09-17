/**
 * Human-facing catalog of every capability an owner can grant.
 *
 * This is the single source for the "Customize Access Permissions" checkboxes
 * in the employee form. It used to be a hand-maintained list inside that
 * component, which silently drifted: 15 real capabilities (proposals, financial
 * plans, insurance, goals, finances, reports.manage, induction, …) existed and
 * were enforced by the API but could not be granted to anyone, because nobody
 * remembered to add them to the form.
 *
 * `Record<Capability, …>` is what stops that happening again: add a capability
 * to the matrix in rbac.ts without giving it a label here and the BUILD FAILS,
 * naming the missing key. The list can never fall behind the enforcement again.
 *
 * Pure data — safe to import from a client component.
 */

import { ALL_CAPABILITIES, type Capability } from "./rbac";

/** Display groups, in the order the form renders them. */
export const CAPABILITY_GROUP_ORDER = [
  "Clients & Households",
  "Leads",
  "Transactions & Operations",
  "Tasks & Service",
  "Team & Office",
  "Documents & Onboarding",
  "Advice & Products",
  "Workflows & Marketing",
  "Compliance",
  "Reports & Dashboards",
  "Settings",
] as const;

export type CapabilityGroup = (typeof CAPABILITY_GROUP_ORDER)[number];

export type CapabilityMeta = {
  group: CapabilityGroup;
  label: string;
  /** Shown as helper text where the plain label could be misread. */
  hint?: string;
  /**
   * Superseded by finer-grained capabilities but still enforced, because a
   * non-empty permission list is an allow-list: removing the key outright
   * would revoke access from everyone who already holds it. Kept out of the
   * picker so it cannot be granted afresh, while existing grants keep working.
   */
  legacy?: true;
};

/**
 * Every capability, labelled. EXHAUSTIVE BY TYPE — do not add a fallback or an
 * index signature, or the compile-time guarantee is lost.
 */
export const CAPABILITY_CATALOG: Record<Capability, CapabilityMeta> = {
  // ── Clients & Households ────────────────────────────────────────────────
  "investor.view.all": { group: "Clients & Households", label: "View all clients" },
  "investor.view.assigned": { group: "Clients & Households", label: "View assigned clients only" },
  "investor.edit.all": { group: "Clients & Households", label: "Edit all clients" },
  "investor.edit.assigned": { group: "Clients & Households", label: "Edit assigned clients only" },
  "investor.bulk_export": { group: "Clients & Households", label: "Bulk export clients", hint: "Exports client PII to Excel" },
  "investor.delete": { group: "Clients & Households", label: "Delete clients permanently", hint: "Irreversible — erases the client's history" },
  "investor.note.add": { group: "Clients & Households", label: "Add client notes" },
  "family.view": { group: "Clients & Households", label: "View households" },
  "family.create": { group: "Clients & Households", label: "Create households" },
  "family.edit": { group: "Clients & Households", label: "Edit households", hint: "Rename, set the primary client, add and remove members" },
  "family.manage": { group: "Clients & Households", label: "Create & edit households (legacy)", legacy: true },
  "family.delete": { group: "Clients & Households", label: "Delete households", hint: "Unlinks every client in the household" },

  // ── Leads ───────────────────────────────────────────────────────────────
  "lead.view.all": { group: "Leads", label: "View all leads" },
  "lead.view.assigned": { group: "Leads", label: "View assigned leads only" },
  "lead.edit.all": { group: "Leads", label: "Edit all leads" },
  "lead.edit.assigned": { group: "Leads", label: "Edit assigned leads only" },

  // ── Transactions & Operations ───────────────────────────────────────────
  "transactions.view": { group: "Transactions & Operations", label: "View transactions" },
  "transactions.execute": { group: "Transactions & Operations", label: "Execute transactions" },
  "onboarding.manage": { group: "Transactions & Operations", label: "Manage onboarding" },
  "kyc.manage": { group: "Transactions & Operations", label: "Manage KYC status" },
  "review_meeting.manage.all": { group: "Transactions & Operations", label: "Manage all review meetings" },
  "review_meeting.manage.assigned": { group: "Transactions & Operations", label: "Manage assigned review meetings" },
  "risk_profile.manage": { group: "Transactions & Operations", label: "Manage risk profiles" },

  // ── Tasks & Service ─────────────────────────────────────────────────────
  "task.view.all": { group: "Tasks & Service", label: "View all tasks" },
  "task.view.assigned": { group: "Tasks & Service", label: "View assigned tasks only" },
  "task.edit.all": { group: "Tasks & Service", label: "Edit all tasks" },
  "task.edit.assigned": { group: "Tasks & Service", label: "Edit assigned tasks only" },
  "service_request.view.all": { group: "Tasks & Service", label: "View all service requests" },
  "service_request.view.assigned": { group: "Tasks & Service", label: "View assigned service requests" },
  "service_request.manage": { group: "Tasks & Service", label: "Manage service requests" },

  // ── Team & Office ───────────────────────────────────────────────────────
  "leave.manage.all": {
    group: "Team & Office",
    label: "Approve & manage everyone's leave",
    hint: "See every employee's leave applications, decide them, and file leave on someone's behalf. Without this a person only sees their own and their direct reports'.",
  },
  "attendance.manage.all": {
    group: "Team & Office",
    label: "Manage everyone's attendance",
    hint: "The firm-wide attendance register: mark/bulk-mark others, decide regularisation requests and export. Without this a person only marks their own.",
  },
  "expense.manage": {
    group: "Team & Office",
    label: "Staff expense tracker",
    hint: "Record and manage staff expenses, budgets and recurring costs — without the firm P&L and salaries, which stay behind View firm finances.",
  },
  "gifting.manage": {
    group: "Team & Office",
    label: "Client gifting & engagement",
    hint: "Run the gifting programme: log, schedule and mark gifts delivered for clients.",
  },
  "complaint.manage": { group: "Tasks & Service", label: "Manage complaints" },

  // ── Documents & Onboarding ──────────────────────────────────────────────
  "document.view": { group: "Documents & Onboarding", label: "View documents" },
  "document.upload": { group: "Documents & Onboarding", label: "Upload documents" },
  "document.delete": { group: "Documents & Onboarding", label: "Delete documents" },
  "induction.view": { group: "Documents & Onboarding", label: "View induction / training" },
  "induction.manage": { group: "Documents & Onboarding", label: "Manage induction / training" },

  // ── Advice & Products ───────────────────────────────────────────────────
  "proposal.view": { group: "Advice & Products", label: "View proposals" },
  "proposal.write": { group: "Advice & Products", label: "Create & edit proposals" },
  "proposal.send": { group: "Advice & Products", label: "Send proposals to clients" },
  "financial_plan.view": { group: "Advice & Products", label: "View financial plans" },
  "financial_plan.manage": { group: "Advice & Products", label: "Create & edit financial plans" },
  "insurance.view": { group: "Advice & Products", label: "View insurance policies" },
  "insurance.write": { group: "Advice & Products", label: "Create & edit insurance policies" },
  "goal.manage": { group: "Advice & Products", label: "Manage client goals" },

  // ── Workflows & Marketing ───────────────────────────────────────────────
  "workflow.view": { group: "Workflows & Marketing", label: "View workflow rules" },
  "workflow.edit": { group: "Workflows & Marketing", label: "Edit workflow rules" },
  "workflow.publish": { group: "Workflows & Marketing", label: "Publish workflow rules" },
  "segments.view": { group: "Workflows & Marketing", label: "View segments & filters" },
  "segments.manage": { group: "Workflows & Marketing", label: "Manage segments & filters" },
  "template.view": { group: "Workflows & Marketing", label: "View comms templates" },
  "template.create": { group: "Workflows & Marketing", label: "Create comms templates" },
  "template.edit": { group: "Workflows & Marketing", label: "Edit comms templates" },
  "template.approve": { group: "Workflows & Marketing", label: "Approve comms templates" },
  "campaign.send": { group: "Workflows & Marketing", label: "Send marketing campaigns" },
  "communication.send": { group: "Workflows & Marketing", label: "Send messages to clients", hint: "One-off WhatsApp / email / SMS" },
  "consent.manage": { group: "Workflows & Marketing", label: "Manage client consents" },

  // ── Compliance ──────────────────────────────────────────────────────────
  "compliance.view": { group: "Compliance", label: "View compliance register" },
  "amc_empanelment.view": { group: "Compliance", label: "View AMC empanelments" },
  "compliance.edit": { group: "Compliance", label: "Edit compliance records" },
  "compliance.approve": { group: "Compliance", label: "Approve compliance items" },
  "sop.manage": { group: "Compliance", label: "Manage SOP library" },

  // ── Reports & Dashboards ────────────────────────────────────────────────
  "reports.business": { group: "Reports & Dashboards", label: "Business reports" },
  "reports.team": { group: "Reports & Dashboards", label: "Team performance reports" },
  "reports.commission": { group: "Reports & Dashboards", label: "Commission reports" },
  "reports.manage": { group: "Reports & Dashboards", label: "Build & manage reports" },
  "finances.view": { group: "Reports & Dashboards", label: "View firm finances" },
  "dashboard.view.owner": { group: "Reports & Dashboards", label: "Owner dashboard", hint: "Firm-wide figures" },
  "dashboard.view.compliance": { group: "Reports & Dashboards", label: "Compliance dashboard" },
  "dashboard.view.marketing": { group: "Reports & Dashboards", label: "Marketing dashboard" },
  "dashboard.view.ops": { group: "Reports & Dashboards", label: "Operations dashboard" },
  "dashboard.view.rm": { group: "Reports & Dashboards", label: "RM dashboard" },
  "dashboard.view.ria": { group: "Reports & Dashboards", label: "RIA dashboard" },
  "dashboard.view.ra": { group: "Reports & Dashboards", label: "RA dashboard" },

  // ── Settings ────────────────────────────────────────────────────────────
  "settings.users": { group: "Settings", label: "Manage team & permissions", hint: "Lets this member change others' access" },
  "settings.billing": { group: "Settings", label: "Manage billing & subscription" },
  "settings.masters": { group: "Settings", label: "Manage master data" },
  "settings.security": { group: "Settings", label: "Manage security settings" },
  "settings.desks": { group: "Settings", label: "Manage desks & assignment" },
};

export type CapabilityGroupView = {
  group: CapabilityGroup;
  items: Array<{ key: Capability; label: string; hint?: string }>;
};

/**
 * The catalog grouped for rendering. Derived from ALL_CAPABILITIES (the matrix
 * keys) so the UI shows exactly what the API enforces — never more, never less.
 */
export const CAPABILITY_GROUPS: CapabilityGroupView[] = CAPABILITY_GROUP_ORDER.map((group) => ({
  group,
  // Legacy capabilities stay enforceable but are never offered as a new grant.
  items: ALL_CAPABILITIES.filter((c) => CAPABILITY_CATALOG[c]?.group === group && !CAPABILITY_CATALOG[c]?.legacy).map((key) => ({
    key,
    label: CAPABILITY_CATALOG[key].label,
    hint: CAPABILITY_CATALOG[key].hint,
  })),
})).filter((g) => g.items.length > 0);
