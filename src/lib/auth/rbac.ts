/**
 * Role-Based Access Control — the source of truth for "who can do what".
 *
 * The spec defines 7 roles (one platform + six tenant):
 *
 *   PLATFORM (lives under tenant_id = PLATFORM_TENANT_ID)
 *     1. platform_admin  — Equitywala super admin. Cross-tenant. Uses withPlatformAdmin().
 *
 *   TENANT-SCOPED (every MFD organisation)
 *     2. owner            — full access inside their MFD
 *     3. rm               — assigned leads / clients only
 *     4. back_office (ops)— operations: onboarding, transactions, KYC
 *     5. marketing        — campaigns + content; no investment data
 *     6. compliance       — DDQ + approvals + consents + SOPs
 *     7. assistant        — limited: assigned tasks only (replaced team_member)
 *     8. gifting_hr       — the client gifting programme, plus HR self-service
 *
 * `branch_head` is a legacy/extra MFD role used to gate aggregated team views.
 * `investor` is reserved for the future client app and has no dashboard caps.
 *
 * Two layers of enforcement:
 *   - UI:  `can(roles, cap)` to hide / disable controls.
 *   - API: `require(roles, cap)` to throw 403 before mutating.
 *
 * Platform capabilities (creating tenants, suspending licenses, package
 * templates) live in the PLATFORM_CAPS list and are checked separately —
 * NOT through this `can()` matrix, because tenants must never grant them.
 */

export type Role =
  | "owner"
  | "rm"
  | "back_office"
  | "ops" // alias for back_office
  | "marketing"
  | "compliance"
  | "branch_head"
  // Support desks. An assistant works an RM's queue; gifting/HR runs the client
  // engagement programme. Neither owns a book.
  | "assistant"
  | "gifting_hr"
  // Distribution + advisory verticals. Each works its OWN book — none of them
  // gets a .all scope by default, because "sees every client in the firm" is a
  // decision an owner makes per person, not something a job title confers.
  | "sub_broker"
  | "ra_research"
  | "ra_sales"
  | "ria"
  | "insurance"
  | "investor";

export const ROLE_LABELS: Record<string, string> = {
  platform_admin: "Super Admin (Equitywala)",
  platform_support: "Admin (Equitywala)",
  owner: "MFD Owner / Admin",
  rm: "Relationship Manager",
  back_office: "Back Office Executive",
  ops: "Back Office Executive",
  marketing: "Marketing Executive",
  compliance: "Compliance / DDQ Executive",
  branch_head: "Branch Head",
  assistant: "Assistant",
  gifting_hr: "Gifting / HR",
  sub_broker: "Sub Broker",
  ra_research: "RA — Research",
  ra_sales: "RA — Sales",
  ria: "RIA",
  insurance: "Insurance",
  investor: "Investor (Client App)",
};

/**
 * Every capability the UI / API enforces.
 *
 * Naming convention: `<entity>.<action>[.scope]`
 *   - .all       = every row in the tenant
 *   - .assigned  = only rows where the user is the owner/RM/assignee
 *
 * Keep this list flat. New caps → add the key, then the role row in MATRIX.
 */
export type Capability =
  // Investor data
  | "investor.view.all"
  | "investor.view.assigned"
  | "investor.edit.all"
  | "investor.edit.assigned"
  | "investor.bulk_export"
  | "investor.delete"
  | "investor.note.add"
  // Households (family mapping). Separate from investor.* so an owner can let
  // a team member group clients into households without granting client edits.
  | "family.view"
  | "family.create"
  | "family.edit"
  // LEGACY: superseded by family.create + family.edit. Still honoured because
  // a non-empty permission list is an ALLOW-LIST — dropping it would silently
  // revoke households from every user who already has it granted. Hidden from
  // the picker (see capability-catalog.ts) so nobody grants it fresh.
  | "family.manage"
  | "family.delete"
  // Leads
  | "lead.view.all"
  | "lead.view.assigned"
  | "lead.edit.all"
  | "lead.edit.assigned"
  // Transactions / SIPs / Mandates
  | "transactions.view"
  | "transactions.execute"
  // Onboarding + KYC (back-office)
  | "onboarding.manage"
  | "kyc.manage"
  // Service requests + Complaints
  | "service_request.view.all"
  | "service_request.view.assigned"
  | "service_request.manage"
  | "complaint.manage"
  // Review meetings
  | "review_meeting.manage.all"
  | "review_meeting.manage.assigned"
  // Tasks
  | "task.view.all"
  | "task.view.assigned"
  | "task.edit.all"
  | "task.edit.assigned"
  // Documents
  | "document.view"
  | "document.upload"
  | "document.delete"
  // Workflows
  | "workflow.view"
  | "workflow.edit"
  | "workflow.publish"
  // Templates + broadcasts + campaigns
  | "template.view"
  | "template.create"
  | "template.edit"
  | "template.approve"
  | "campaign.send"
  | "communication.send"
  // Segments (audience lists for campaigns + workflow triggers)
  | "segments.view"
  | "segments.manage"
  // Proposals (Mutual Fund / Insurance / PMS / AIF)
  | "proposal.view"
  | "proposal.write"
  | "financial_plan.view"
  | "financial_plan.manage"
  | "proposal.send"
  // Insurance policy register
  | "insurance.view"
  | "insurance.write"
  // Compliance + DDQ + risk profile + consent + SOP
  | "compliance.view"
  | "amc_empanelment.view"
  | "induction.view"
  | "induction.manage"
  | "compliance.edit"
  | "compliance.approve"
  | "risk_profile.manage"
  | "goal.manage"
  | "consent.manage"
  | "sop.manage"
  // Reports
  | "reports.business"
  | "reports.team"
  | "reports.commission"
  | "reports.manage"
  // Practice finances — the firm's OWN books (P&L, net profit, margin, the
  // expense ledger incl. team salaries). Owner-confidential; distinct from
  // reports.commission (which is broader, for commission MIS / reconciliation).
  | "finances.view"
  // Dashboards
  | "dashboard.view.owner"
  | "dashboard.view.compliance"
  | "dashboard.view.marketing"
  | "dashboard.view.ops"
  | "dashboard.view.rm"
  // Master settings + admin
  | "settings.users"
  | "settings.billing"
  | "settings.masters"
  | "settings.security"
  | "settings.desks";


/**
 * Capability matrix per role. Roles in the array are allowed.
 * `owner` is granted everything via the special case in `can()`.
 */
const MATRIX: Record<Capability, Role[]> = {
  // Investor data — back_office sees all, RM sees assigned, marketing blocked.
  "investor.view.all": ["compliance", "back_office", "ops", "gifting_hr"],
  "investor.view.assigned": ["rm", "branch_head", "sub_broker", "ra_sales", "ria", "insurance"],
  "investor.edit.all": ["back_office", "ops"],
  "investor.edit.assigned": ["rm", "ria", "gifting_hr"],
  "investor.bulk_export": ["compliance"],
  // Permanent hard-delete of a client + its owned data subgraph (cascades).
  // Deliberately NARROWER than investor.edit.all: editing a phone number must
  // not imply the power to irreversibly erase a client's whole history. Owner
  // wins via can(); compliance owns DPDP erasure. RM / back_office / ops do NOT
  // get it — they soft-close instead.
  "investor.delete": ["compliance"],
  "investor.note.add": ["rm", "back_office", "ops", "branch_head", "compliance", "sub_broker", "ra_sales", "ria", "insurance"],
  // Households: an RM groups their OWN book into families, so they manage.
  // Deleting unlinks every client in the household, so it stays narrower.
  "family.view": ["rm", "back_office", "ops", "branch_head", "compliance", "ria"],
  "family.create": ["rm", "back_office", "ops", "branch_head", "ria"],
  "family.edit": ["rm", "back_office", "ops", "branch_head", "ria"],
  "family.manage": ["rm", "back_office", "ops", "branch_head", "ria"],
  "family.delete": ["back_office", "ops"],

  // Leads — marketing + owner own pipeline; RM works assigned.
  "lead.view.all": ["marketing", "branch_head", "compliance"],
  "lead.view.assigned": ["rm", "sub_broker", "ra_sales", "ria", "insurance"],
  "lead.edit.all": ["marketing", "branch_head"],
  "lead.edit.assigned": ["rm", "sub_broker", "ra_sales", "ria", "insurance"],

  // Transactions — execute by back_office + RM; everyone in ops/compliance views.
  "transactions.view": ["back_office", "ops", "rm", "branch_head", "compliance", "sub_broker", "ra_sales", "ria"],
  "transactions.execute": ["back_office", "ops", "rm"],

  // Back-office specialties
  "onboarding.manage": ["back_office", "ops"],
  "kyc.manage": ["back_office", "ops", "compliance"],

  // Service requests / complaints
  "service_request.view.all": ["back_office", "ops", "compliance"],
  "service_request.view.assigned": ["rm", "sub_broker", "ria", "insurance"],
  "service_request.manage": ["back_office", "ops"],
  "complaint.manage": ["compliance", "back_office", "ops"],

  // Review meetings — back_office plans for all, RM runs assigned
  "review_meeting.manage.all": ["back_office", "ops", "branch_head"],
  "review_meeting.manage.assigned": ["rm", "sub_broker", "ra_sales", "ria", "insurance"],

  // Tasks — every working role, including the support desks that only ever
  // work what is handed to them.
  "task.view.all": ["compliance", "back_office", "ops", "marketing", "branch_head"],
  "task.view.assigned": ["rm", "assistant", "gifting_hr", "branch_head", "sub_broker", "ra_sales", "ria", "insurance", "marketing", "ra_research"],
  "task.edit.all": ["back_office", "ops", "marketing"],
  "task.edit.assigned": ["rm", "assistant", "gifting_hr", "compliance", "branch_head", "sub_broker", "ra_sales", "ria", "insurance", "marketing", "ra_research"],

  // Documents
  "document.view": ["compliance", "back_office", "ops", "rm", "branch_head", "marketing", "sub_broker", "ra_research", "ra_sales", "ria", "insurance"],
  // Induction (team training). Everyone can see their OWN track; managing
  // tracks/questions sits with compliance + branch heads (owner bypasses).
  "induction.view": ["rm", "branch_head", "back_office", "ops", "marketing", "compliance", "assistant", "gifting_hr", "sub_broker", "ra_research", "ra_sales", "ria", "insurance"],
  "induction.manage": ["compliance", "branch_head"],
  "document.upload": ["back_office", "ops", "rm", "compliance", "assistant", "branch_head"],
  "document.delete": ["compliance"],

  // Workflows — ops/compliance draft, owner + compliance publish (publishing
  // changes live automation, so it stays close to the compliance gate).
  "workflow.view": ["compliance", "marketing", "back_office", "ops"],
  "workflow.edit": ["back_office", "ops", "compliance"],
  "workflow.publish": ["compliance"],

  // Templates + campaigns + content calendar
  "template.view": ["marketing", "compliance", "ra_research", "ra_sales"],
  // AUTHORING a template — create, edit, new version, submit for approval,
  // archive — is firm-admin only. An approved template is what the firm is
  // allowed to say to investors, so writing one is a compliance decision rather
  // than day-to-day work. No role grants it: the empty list means only `owner`
  // passes (via the short-circuit above). An owner can still delegate it
  // per-person by ticking it under Customize Access Permissions.
  //
  // Kept SEPARATE from template.edit deliberately. Despite the name,
  // template.edit no longer touches template content at all — it gates
  // content-library uploads, the email-designer test send and the WhatsApp
  // template sync. Emptying that instead would quietly strip Marketing of those
  // unrelated abilities.
  "template.create": [],
  "template.edit": ["marketing"],
  "template.approve": ["compliance"],
  "campaign.send": ["marketing"],
  // Ad-hoc 1:1 client email (Compose) — the front-line + ops who actually
  // correspond with clients; marketing already has campaign.send for bulk.
  "communication.send": ["rm", "branch_head", "back_office", "ops", "marketing", "sub_broker", "ra_sales", "ria", "insurance"],

  // Segments (audience lists). Marketing builds them for campaigns;
  // back-office reads to seed workflow triggers.
  "segments.view": ["marketing", "back_office", "ops", "compliance", "branch_head", "ra_research"],
  "segments.manage": ["marketing", "back_office", "ops"],

  // Proposals — RM/back_office prepare, compliance reviews, owner sends.
  "proposal.view": ["rm", "branch_head", "back_office", "ops", "compliance", "marketing", "sub_broker", "ra_sales", "ria", "insurance"],
  "proposal.write": ["rm", "branch_head", "back_office", "ops", "ra_sales", "ria", "insurance"],
  // Financial plans are a distinct advisory deliverable — same role set as
  // proposals so no one loses access, but a dedicated capability.
  "financial_plan.view": ["rm", "branch_head", "back_office", "ops", "compliance", "marketing", "ria"],
  "financial_plan.manage": ["rm", "branch_head", "back_office", "ops", "ria"],
  "proposal.send": ["rm", "branch_head", "ra_sales", "ria", "insurance"],

  // Insurance — RM + back-office maintain; compliance reads.
  "insurance.view": ["rm", "branch_head", "back_office", "ops", "compliance", "ria", "insurance"],
  "insurance.write": ["rm", "branch_head", "back_office", "ops", "insurance"],

  // Compliance + adjacent
  "compliance.view": ["compliance"],
  // AMC empanelments — distributor codes, negotiated trail rates and the AMC
  // escalation tree. Commercial relationship data, so branch heads only; owner
  // passes via the short-circuit above, and an owner can delegate it to a
  // specific person by ticking it under Customize Access Permissions.
  "amc_empanelment.view": ["branch_head"],
  "compliance.edit": ["compliance"],
  "compliance.approve": ["compliance"],
  "risk_profile.manage": ["compliance", "back_office", "ops", "rm", "ra_sales", "ria"],
  // Goal planning is an RM/back-office advisory task (distinct from risk
  // profiling). branch_head supervises; compliance kept for back-compat with
  // the prior risk_profile.manage gate so no one loses existing access.
  "goal.manage": ["rm", "branch_head", "back_office", "ops", "compliance", "ra_sales", "ria"],
  "consent.manage": ["compliance", "back_office", "ops"],
  "sop.manage": ["compliance"],

  // Reports
  "reports.business": ["compliance", "branch_head", "ra_research"],
  "reports.team": ["branch_head"],
  // Commission/brokerage MIS — the back-office team that runs reconciliation,
  // branch heads (team payout view) and compliance. Owner sees all via the
  // hard-case in can(). RMs are intentionally excluded (firm-level economics).
  "reports.commission": ["back_office", "ops", "branch_head", "compliance"],
  // Practice finances (firm P&L + salaries) — owner-grade. Back-office keeps
  // access as the bookkeeper who maintains the expense ledger; ops / branch_head
  // / compliance are deliberately excluded (the firm's profit + team salaries are
  // owner-confidential). Owner wins via the hard-case in can().
  "finances.view": ["back_office"],
  // Custom report builder — can compose reports over any catalog field
  // (incl. PII columns), so it's limited to management/back-office roles.
  // Owner wins via can(). RM/ops excluded until per-field gating lands.
  "reports.manage": ["branch_head", "compliance", "back_office"],

  // Dashboards
  "dashboard.view.owner": ["compliance", "branch_head"],
  "dashboard.view.compliance": ["compliance"],
  "dashboard.view.marketing": ["marketing", "ra_research"],
  "dashboard.view.ops": ["back_office", "ops"],
  "dashboard.view.rm": ["rm", "sub_broker", "ra_sales", "ria", "insurance"],

  // Org admin. User management + billing stay owner-only by design (account
  // ownership boundary) — owner is granted them via the hard-case in can().
  // Master lookup lists are operational data the back-office/compliance team
  // legitimately maintains, so they're delegable.
  "settings.users": [],
  "settings.billing": [],
  "settings.masters": ["compliance", "back_office", "ops"],
  "settings.security": ["compliance"],
  // Desks are sub-branch team structure (RM → desk → branch rollup). Branch
  // heads own their branch's desks; ops/back-office admins maintain the org
  // chart. Owner is granted via the hard-case in can().
  "settings.desks": ["branch_head", "back_office", "ops"],
};

/**
 * Roles a tenant admin is allowed to GRANT to a team member (invite / edit).
 *
 * CRITICAL: this excludes the platform roles (`platform_admin`,
 * `platform_support`) and `investor`. A tenant must never be able to mint a
 * platform_admin — that role bypasses tenant RLS via withPlatformAdmin() and
 * would be a cross-tenant superuser escalation. Always validate inbound role
 * arrays against this set before persisting them.
 */
export const ASSIGNABLE_ROLES: Role[] = [
  "owner",
  "rm",
  "back_office",
  "ops",
  "marketing",
  "compliance",
  "branch_head",
  "assistant",
  "gifting_hr",
  "sub_broker",
  "ra_research",
  "ra_sales",
  "ria",
  "insurance",
];

const ASSIGNABLE_ROLE_SET = new Set<string>(ASSIGNABLE_ROLES);

/** True iff every role in the list is a tenant-assignable role. */
export function areAssignableRoles(roles: string[] | undefined | null): boolean {
  return Array.isArray(roles) && roles.length > 0 && roles.every((r) => ASSIGNABLE_ROLE_SET.has(r));
}

/** Runtime list of every tenant capability (the keys of MATRIX). */
export const ALL_CAPABILITIES = Object.keys(MATRIX) as Capability[];
const CAPABILITY_SET = new Set<string>(ALL_CAPABILITIES);

/** True iff every entry is a known capability (used to validate custom grants). */
export function areKnownCapabilities(caps: string[] | undefined | null): boolean {
  return Array.isArray(caps) && caps.every((c) => CAPABILITY_SET.has(c));
}

/**
 * Platform-level (Equitywala) capabilities. Held only by `platform_admin`.
 * These actions hit /super-admin/* routes; they bypass tenant RLS via
 * `withPlatformAdmin()` in src/db/client.ts.
 */
export type PlatformCapability =
  | "platform.tenant.create"
  | "platform.tenant.suspend"
  | "platform.tenant.activate"
  | "platform.tenant.edit"
  | "platform.tenant.delete"
  | "platform.tenant.view_all"
  | "platform.tenant.usage"
  | "platform.package.manage"
  | "platform.license.assign"
  | "platform.billing.manage"
  | "platform.support.view"
  | "platform.master.manage"
  | "platform.staff.manage"
  | "platform.settings.manage";

export const PLATFORM_CAPS: PlatformCapability[] = [
  "platform.tenant.create",
  "platform.tenant.suspend",
  "platform.tenant.activate",
  "platform.tenant.edit",
  "platform.tenant.delete",
  "platform.tenant.view_all",
  "platform.tenant.usage",
  "platform.package.manage",
  "platform.license.assign",
  "platform.billing.manage",
  "platform.support.view",
  "platform.master.manage",
  "platform.staff.manage",
  "platform.settings.manage",
];

/** Returns true if the caller has the capability via any of their roles OR a custom permission grant. */
export function can(userRoles: string[] | undefined, cap: Capability, userPermissions?: string[] | null): boolean {
  if (!userRoles?.length) return false;
  if (userRoles.includes("owner")) return true; // owner always wins

  // A NON-EMPTY custom permission list is an ALLOW-LIST: it defines exactly
  // what this user may do. That is what “Customize access permissions” in the
  // employee form promises — ticking grants, UNTICKING TAKES AWAY. Treating it
  // as merely additive (the previous behaviour) made every untick a no-op,
  // because the role still granted the capability underneath.
  //
  // Empty or absent means “inherit the role defaults”, and that distinction is
  // load-bearing: sessions issued before this change carry permissions: [] for
  // every non-customised user, so treating [] as an allow-list would have
  // locked out everyone holding an existing token. The form fills the list from
  // the role’s defaults the moment Customize is ticked, so a real list is
  // always complete rather than a single stray grant.
  if (userPermissions && userPermissions.length > 0) {
    return userPermissions.includes(cap);
  }

  // Role-matrix grant.
  const allowed = MATRIX[cap] ?? [];
  if (userRoles.some((r) => allowed.includes(r as Role))) return true;

  return false;
}

/** Throws a 403-shaped error if the caller is not authorised. */
export function require(userRoles: string[] | undefined, cap: Capability, userPermissions?: string[] | null): void {
  if (!can(userRoles, cap, userPermissions)) {
    throw Object.assign(new Error(`forbidden: missing ${cap}`), { status: 403 });
  }
}

/**
 * Pass-if-any helper — handler that legitimately accepts multiple
 * capabilities (e.g. lead create allowed for owners, marketing, RMs,
 * AND branch heads). Avoids ugly inline OR chains.
 *
 *   requireAny(session.roles, ["lead.edit.all", "lead.edit.assigned"], session.permissions);
 */
export function requireAny(userRoles: string[] | undefined, caps: Capability[], userPermissions?: string[] | null): void {
  if (caps.some((c) => can(userRoles, c, userPermissions))) return;
  throw Object.assign(new Error(`forbidden: missing one of ${caps.join(", ")}`), { status: 403 });
}

/**
 * Platform-capability check — separate from the tenant `can()` matrix because
 * tenant role mixtures must never grant these.
 */
export function canPlatform(userRoles: string[] | undefined, cap: PlatformCapability): boolean {
  if (!userRoles?.length) return false;
  // "Super Admin" (platform_admin) and "Admin" (platform_support) are BOTH full
  // platform administrators — each can perform every platform action, including
  // creating other Admins and Super Admins. (Historically platform_support was
  // read-only; it was promoted to a full "Admin" tier.)
  if (!userRoles.includes("platform_admin") && !userRoles.includes("platform_support")) return false;
  return PLATFORM_CAPS.includes(cap);
}

export function requirePlatform(userRoles: string[] | undefined, cap: PlatformCapability): void {
  if (!canPlatform(userRoles, cap)) {
    throw Object.assign(new Error(`forbidden: missing platform capability ${cap}`), { status: 403 });
  }
}

/** Returns the most senior role label for UI display. */
export function primaryRoleLabel(roles: string[]): string {
  if (roles.includes("platform_admin")) return ROLE_LABELS.platform_admin;
  if (roles.includes("platform_support")) return ROLE_LABELS.platform_support;
  for (const r of ["owner", "compliance", "marketing", "back_office", "ops", "rm", "branch_head", "assistant", "gifting_hr"]) {
    if (roles.includes(r)) return ROLE_LABELS[r] ?? r;
  }
  return roles[0] ?? "User";
}

/** Returns the default home page for a role. */
export function defaultHomeFor(roles: string[]): string {
  if (roles.includes("platform_admin") || roles.includes("platform_support")) return "/super-admin";
  if (roles.includes("owner")) return "/dashboard";
  if (roles.includes("compliance")) return "/dashboard/compliance";
  if (roles.includes("marketing")) return "/dashboard/campaigns";
  // back_office / ops used to land on /dashboard/onboarding before the
  // module was retired (its 11-stage pipeline merged into the unified
  // blueprint engine that lives in Leads + Clients). Send them to Tasks
  // — that's the work-queue view they actually use day to day.
  if (roles.includes("back_office") || roles.includes("ops")) return "/dashboard/tasks";
  if (roles.includes("rm") || roles.includes("branch_head")) return "/dashboard";
  if (roles.includes("assistant")) return "/dashboard/tasks";
  return "/dashboard/tasks";
}
