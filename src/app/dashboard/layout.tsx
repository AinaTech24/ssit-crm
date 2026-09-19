import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  Workflow,
  Zap,
  MessageSquare,
  ListChecks,
  ShieldCheck,
  Settings,
  Sparkles,
  Crosshair,
  Send,
  ClipboardCheck,
  ScrollText,
  HeartHandshake,
  Gift,
  Share2,
  Target,
  TrendingUp,
  Repeat,
  Calendar,
  FileSignature,
  Shield,
  Megaphone,
  FlaskConical,
  Image as ImageIcon,
  UserCog, GraduationCap,
  CalendarOff,
  CalendarCheck,
  BarChart3,
  FolderArchive,
  Scale,
  Lock,
  Bot,
  CreditCard,
  AlertTriangle,
  HelpCircle,
  Briefcase,
  Boxes,
  Trash2,
  PhoneCall,
  Copy,
  PieChart,
  Calculator,
  Wallet,
  Server,
  Inbox,
  Activity,
  // ── unique-icon replacements for the de-duplicated sidebar ──
  UserPlus,
  Presentation,
  ShieldAlert,
  LayoutTemplate,
  Library,
  Gauge,
  FileCheck,
  ClipboardList,
  Newspaper,
  Stamp,
  BellRing,
  Package,
  FolderOpen,
  Building2,
  Network,
  LifeBuoy,
  IndianRupee,
} from "lucide-react";
import { eq, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { tenants, users, tenantUiLayouts } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { primaryRoleLabel, can } from "@/lib/auth/rbac";
import { loadTenantLicense } from "@/lib/auth/license";
import { tenantAccessibleNavKeys, isGatableNav, gatedNavKeyForPath, roleDefaultNavKeys } from "@/config/nav-access";
import { pickLogo } from "@/lib/branding/logo";
import type { Metadata } from "next";
import { GlobalSearch } from "@/components/layout/GlobalSearch";
import { NotificationBell } from "@/components/layout/NotificationBell";
import { BirthdayBell } from "@/components/layout/BirthdayBell";
import { WhatsNewBell } from "@/components/layout/WhatsNewBell";
import { DesktopSidebar } from "@/components/layout/DesktopSidebar";
import { SessionRegister } from "@/components/layout/SessionRegister";
import { CustomizableNav, type NavItemData } from "@/components/layout/CustomizableNav";
import { loadModuleControls } from "@/lib/platform/module-controls";
import { QuickCreateFab } from "@/components/layout/QuickCreateFab";
import { CommandPalette } from "@/components/layout/CommandPalette";
import ProductTour from "@/components/layout/ProductTour";
import { MobileNav } from "@/components/layout/MobileNav";
import { ProfileMenu } from "@/components/layout/ProfileMenu";
import { ToastProvider } from "@/components/ui/Toast";
import { buildTenantThemeCss } from "@/lib/branding/theme";

export const dynamic = "force-dynamic";

type NavItem = {
  href: string;
  label: string;
  icon: any;
  /** Required role (any of). If omitted, visible to all. */
  roles?: string[];
  /** Required module key — gated by tenant package. */
  module?: string;
};

type NavSection = { title: string; items: NavItem[] };

const NAV: NavSection[] = [
  {
    title: "",
    items: [
      // Dashboard + My Dashboards are merged into the DashboardNavDropdown
      // rendered at the top of CustomizableNav.
      { href: "/dashboard/command-center", label: "My Day", icon: Inbox,
        roles: ["owner", "rm", "branch_head", "back_office", "ops", "compliance", "insurance", "sub_broker"] },
      { href: "/dashboard/tasks", label: "Tasks", icon: ListChecks, module: "tasks" },
      // Marketing logs what it produced; RA/RIA log what they researched.
      { href: "/dashboard/activity-tracker", label: "Activity Tracker", icon: Megaphone,
        roles: ["owner", "branch_head", "marketing"] },
      { href: "/dashboard/research-tracker", label: "Daily Activity Tracker", icon: FlaskConical,
        roles: ["owner", "branch_head", "ria", "ra_research", "ra_sales"] },
      { href: "/dashboard/service-requests", label: "Service Requests", icon: LifeBuoy, module: "service_requests" },
      { href: "/dashboard/review-meetings", label: "Meetings", icon: Presentation, module: "review_meetings",
        roles: ["owner", "rm", "branch_head", "back_office", "ops", "insurance", "sub_broker"] },
      { href: "/dashboard/attendance", label: "Attendance", icon: CalendarCheck },
      { href: "/dashboard/trash", label: "Trash", icon: Trash2, roles: ["owner", "compliance", "branch_head"] },
      // Team Dashboard now lives inside the top "Dashboards" dropdown
      // (see dashboardSubItems below + DashboardNavDropdown).
    ],
  },
  {
    title: "CRM",
    items: [
      // Leads visible to owner, marketing, rm, branch_head.
      // Pipeline Board is now reached via the in-page Module switcher on the
      // Leads page (Leads ⇄ Pipeline Board), not a separate sidebar item.
      { href: "/dashboard/leads", label: "Leads", icon: UserPlus, module: "lead_management",
        roles: ["owner", "marketing", "rm", "branch_head", "back_office", "ops", "compliance", "sub_broker"] },
      // Investor data hidden from marketing per spec section 3
      { href: "/dashboard/investors", label: "Clients", icon: Users, module: "client_master",
        roles: ["owner", "rm", "branch_head", "back_office", "ops", "compliance", "sub_broker"] },
      { href: "/dashboard/families", label: "Family Mapping", icon: HeartHandshake, module: "family_mapping",
        roles: ["owner", "rm", "branch_head", "back_office", "ops", "compliance"] },
      // No "rm": the page is firm-wide with no per-RM scoping (see its
      // requireAny), so an RM would only get a locked door.
      { href: "/dashboard/referrals", label: "Referrals", icon: Share2, module: "client_master",
        roles: ["owner", "branch_head", "back_office", "ops", "compliance"] },
      // Cross-sell whitespace, inverted: the client page records one product
      // status per client, this reads the whole book at once. Scoped per-RM
      // inside the page, so unlike Referrals an RM gets a useful view, not a
      // locked door.
      { href: "/dashboard/opportunities", label: "Opportunities", icon: Crosshair, module: "client_master",
        roles: ["owner", "rm", "branch_head", "back_office", "ops"] },
      // Client Onboarding module retired — its 11-stage pipeline is now
      // covered by the unified 30-stage blueprint engine that owns both
      // Leads (1-10) and Clients (11-30). Page redirects to /dashboard/leads.
      // The gifting programme. Firm-wide reads (per-RM league table), so the
      // roles here match the capability the page requires — no "rm", same
      // reasoning as Referrals above.
      { href: "/dashboard/engagement", label: "Client Engagement", icon: Gift, module: "client_master",
        roles: ["owner", "back_office", "ops", "compliance", "gifting_hr", "assistant"] },
      { href: "/dashboard/risk-profiles", label: "Risk Profile", icon: Gauge, module: "risk_profile",
        roles: ["owner", "compliance", "back_office", "ops", "rm"] },
      { href: "/dashboard/discovery", label: "Client Discovery", icon: ClipboardList,
        roles: ["owner", "rm", "branch_head", "back_office", "ops", "compliance"] },
      { href: "/dashboard/calculators", label: "Calculators", icon: Calculator },
      { href: "/dashboard/goals", label: "Goal Planning", icon: Target, module: "goal_planning",
        roles: ["owner", "rm", "branch_head", "back_office", "ops"] },
      { href: "/dashboard/proposals", label: "Proposals", icon: FileSignature, module: "proposals",
        roles: ["owner", "rm", "branch_head", "back_office", "ops", "compliance"] },
      { href: "/dashboard/financial-plans", label: "Financial Plans", icon: ClipboardList, module: "goal_planning",
        roles: ["owner", "rm", "branch_head", "back_office", "ops", "compliance"] },
      // One Insurance module. Claims / Renewals / Protection-gap / Commission
      // were separate sidebar entries for what is really one domain — they are
      // now tabs inside the module (see ModuleTabs INSURANCE_TABS), so every
      // view is still one click away without five nav rows.
      { href: "/dashboard/insurance", label: "Insurance", icon: Shield, module: "insurance",
        roles: ["owner", "rm", "branch_head", "back_office", "ops", "compliance", "insurance"] },
    ],
  },
  {
    title: "Operations",
    items: [
      // Transactions hidden from marketing
      { href: "/dashboard/transactions", label: "MF Transactions", icon: Repeat, module: "transactions",
        roles: ["owner", "back_office", "ops", "rm", "branch_head", "compliance"] },
      { href: "/dashboard/business-entries", label: "Business Entries", icon: Briefcase, module: "business_entries",
        roles: ["owner", "branch_head", "rm", "back_office", "ops"] },
      { href: "/dashboard/expected-inflows", label: "Expected Inflows", icon: IndianRupee,
        roles: ["owner", "branch_head", "rm", "back_office", "ops"] },
      { href: "/dashboard/rta-imports", label: "RTA File Imports", icon: FolderArchive, module: "transactions",
        roles: ["owner", "back_office", "ops", "compliance"] },
      { href: "/dashboard/reconciliation", label: "Reconciliation", icon: Scale, module: "transactions",
        roles: ["owner", "back_office", "ops", "compliance"] },
      // One SIP module. Rejections + At-risk were separate sidebar entries (and
      // SIP Rejections additionally existed as a report) — they are now tabs
      // inside the module (see ModuleTabs SIP_TABS).
      { href: "/dashboard/sips", label: "SIP Book", icon: TrendingUp, module: "sip_tracker",
        roles: ["owner", "back_office", "ops", "rm", "branch_head", "compliance"] },
      { href: "/dashboard/activities", label: "Activity Log", icon: PhoneCall,
        roles: ["owner", "rm", "branch_head", "back_office", "ops", "compliance"] },
      // Service Requests, Complaints and Daily Tracker are now their own sidebar
      // items in the General group (directly under Tasks), each with its own
      // access gate — no longer bundled into the Tasks page module switcher.
    ],
  },
  {
    title: "Automation",
    items: [
      { href: "/dashboard/workflows/rules", label: "Workflow Rules", icon: Workflow, module: "automation_workflows" },
      { href: "/dashboard/workflows/actions", label: "Workflow Actions", icon: Zap, module: "automation_workflows" },
      { href: "/dashboard/workflows/runs", label: "Automation Monitor", icon: Activity, module: "automation_workflows",
        roles: ["owner", "compliance", "back_office", "ops"] },
      { href: "/dashboard/templates", label: "Templates", icon: LayoutTemplate, module: "broadcasts" },
      { href: "/dashboard/campaigns", label: "Marketing Campaigns", icon: Megaphone, module: "marketing_campaigns", roles: ["owner", "marketing"] },
      { href: "/dashboard/ssit-library", label: "Equitywala Content Library", icon: Library, roles: ["owner", "marketing", "rm", "branch_head", "back_office", "ops"] },
      { href: "/dashboard/communications", label: "Communications", icon: MessageSquare, module: "broadcasts" },
    ],
  },
  {
    title: "Compliance & Team",
    items: [
      { href: "/dashboard/compliance/command-center", label: "Compliance Center", icon: ShieldCheck, roles: ["owner", "compliance", "branch_head"] },
      { href: "/dashboard/compliance", label: "DDQ Readiness", icon: FileCheck, module: "ddq", roles: ["owner", "compliance"] },
      { href: "/dashboard/compliance/amfi-circulars", label: "Circular Digest", icon: Newspaper, roles: ["owner", "compliance", "back_office", "ops", "rm", "branch_head"] },
      { href: "/dashboard/documents", label: "Documents", icon: FolderOpen, module: "documents" },
      { href: "/dashboard/sops", label: "SOP Library", icon: ScrollText, roles: ["owner", "compliance"] },
      { href: "/dashboard/announcements", label: "Announcements", icon: BellRing },
      { href: "/dashboard/duplicates", label: "Find Duplicates", icon: Copy, roles: ["owner", "branch_head"] },
      { href: "/dashboard/employees", label: "Employees", icon: UserCog, module: "employees", roles: ["owner"] },
      // Induction is deliberately un-role-gated: it is the member's OWN training.
      { href: "/dashboard/induction", label: "Induction", icon: GraduationCap },
      { href: "/dashboard/leave-applications", label: "Leave Applications", icon: CalendarOff },
      { href: "/dashboard/sub-distributors", label: "Sub-Distributors", icon: Network, roles: ["owner", "compliance"] },
      { href: "/dashboard/legal-registrations", label: "Legal Registrations", icon: Stamp, roles: ["owner", "compliance"] },
      // Branch heads only (owner always passes) — matches amc_empanelment.view
      // on the page. Compliance and back office lose the link they had; they
      // never needed the negotiated trail rates.
      { href: "/dashboard/amc-empanelments", label: "AMC Empanelments", icon: Building2, roles: ["owner", "branch_head"] },
      { href: "/dashboard/schemes", label: "Scheme Master", icon: Boxes, roles: ["owner", "compliance", "back_office", "branch_head", "rm"] },
      { href: "/dashboard/product-offerings", label: "Products & Services", icon: Package, roles: ["owner", "compliance"] },
    ],
  },
  // NB: Billing / Firm Profile / Settings and the Help link intentionally do
  // NOT appear in the sidebar — Billing + Settings + Firm profile live in the
  // profile dropdown; the help shortcut is the "?" icon in the top bar.
  {
    title: "Insights",
    items: [
      { href: "/dashboard/reports", label: "Reports & MIS", icon: BarChart3, module: "reports", roles: ["owner", "branch_head", "compliance"] },
      // NOTE: Trail Forecast / Churn-risk / Tax-Harvesting / Cross-sell (and
      // Nomination Tracker, removed from Compliance below) were standalone sidebar
      // items that only deep-linked into /dashboard/reports/* — the identical pages
      // already live in the Reports & MIS catalog (see reports/page.tsx). The
      // duplicate nav entries are removed; every report is unchanged and still
      // reachable from Reports & MIS.
      { href: "/dashboard/portfolio-intelligence", label: "Portfolio Intelligence", icon: PieChart, roles: ["owner", "branch_head", "compliance", "rm", "back_office", "ops"] },
      { href: "/dashboard/commission-reconciliation", label: "Commission Reconciliation", icon: CreditCard, module: "reports", roles: ["owner", "compliance", "back_office"] },
      { href: "/dashboard/finances", label: "Practice Finances", icon: Wallet, module: "reports", roles: ["owner", "compliance", "back_office"] },
      { href: "/dashboard/ai-assistant", label: "Equitywala Copilot", icon: Bot, module: "ai_assistant" },
      { href: "/dashboard/audit-log", label: "Audit Log", icon: ClipboardCheck, module: "audit_log", roles: ["owner", "compliance"] },
    ],
  },
];

function NavBlockedNotice() {
  return (
    <div className="max-w-lg mx-auto mt-12 card-elevated p-10 text-center">
      <div className="size-16 mx-auto rounded-2xl bg-amber-100 grid place-items-center shadow-md">
        <Lock className="size-8 text-amber-600" />
      </div>
      <h1 className="text-2xl font-bold mt-5 tracking-tight">Section not available</h1>
      <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
        This module isn&apos;t enabled for your account. Ask your firm owner (or Equitywala) to grant access.
      </p>
      <Link href="/dashboard" className="btn-primary mt-6 inline-flex">
        Back to dashboard
      </Link>
    </div>
  );
}

export async function generateMetadata(): Promise<Metadata> {
  // Per-tenant favicon + browser-tab title. Wrapped in try/catch so a metadata
  // hiccup (e.g. no session) never takes down the dashboard render.
  try {
    const session = await requireSession();
    const branding = await withTenant(session.tenantId, async (tx) => {
      const [t] = await tx
        .select({
          displayName: tenants.displayName,
          logoUrl: tenants.logoUrl,
          logoIconUrl: tenants.logoIconUrl,
          logoMarkUrl: tenants.logoMarkUrl,
          faviconUrl: tenants.faviconUrl,
        })
        .from(tenants)
        .where(eq(tenants.id, session.tenantId))
        .limit(1);
      return t;
    });
    const icon = pickLogo(branding, "favicon");
    return {
      title: branding?.displayName ? `${branding.displayName} — CRM` : undefined,
      icons: icon ? { icon } : undefined,
    };
  } catch {
    return {};
  }
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const license = await loadTenantLicense(session.tenantId, session.roles);
  // Admin → MFD sidebar access: the exact set of nav hrefs the firm can open
  // (the platform admin's explicit grant, else the package-module default).
  const tenantAllowedSet = new Set(
    tenantAccessibleNavKeys({
      allowedNav: license.allowedNav,
      navGrantCatalog: license.navGrantCatalog,
      enabledModules: license.enabledModules,
      enabledFeatures: license.enabledFeatures,
    })
  );

  // Read the current path from the middleware-set header so we can carve out
  // billing + support pages while the rest of the dashboard is restricted.
  const reqHeaders = await headers();
  const pathname = reqHeaders.get("x-pathname") ?? "";

  const { tenant, userModules, avatarUrl, twoFaEnabled, announcementCount, whatsNewUnread } = await withTenant(session.tenantId, async (tx) => {
    const [t] = await tx.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1);
    // Per-user sidebar module grant (Module-19). null = inherit all tenant modules.
    const [u] = await tx
      .select({ enabledModules: users.enabledModules, avatarUrl: users.avatarUrl, twoFaEnabled: users.twoFaEnabled })
      .from(users)
      .where(eq(users.id, session.userId))
      .limit(1);
    // Active announcements visible to THIS user — drives the sidebar count badge
    // (same active filter as GET /api/announcements: published, not expired,
    // branch + audience-role match).
    const rolesJson = JSON.stringify(session.roles);
    const annRes = await tx.execute(sql`
      SELECT count(*)::int AS n FROM announcements a
      WHERE a.tenant_id = ${session.tenantId}::uuid
        AND a.published_at IS NOT NULL AND a.published_at <= now()
        AND (a.expires_at IS NULL OR a.expires_at > now())
        AND (a.branch_id IS NULL OR a.branch_id = ${session.branchId ?? null})
        AND (
          a.audience_roles IS NULL
          OR jsonb_array_length(a.audience_roles) = 0
          OR a.audience_roles ?| array(SELECT jsonb_array_elements_text(${rolesJson}::jsonb))
        )
    `);
    const whatsNewRes = await tx.execute(sql`
      SELECT count(*)::int AS n FROM release_notes rn
       WHERE rn.published_at IS NOT NULL AND rn.published_at <= now()
         AND NOT EXISTS (
           SELECT 1 FROM release_note_reads r
            WHERE r.release_note_id = rn.id
              AND r.user_id = ${session.userId}::uuid
              AND r.tenant_id = ${session.tenantId}::uuid)
    `);
    return {
      tenant: t,
      userModules: (u?.enabledModules as string[] | null) ?? null,
      avatarUrl: (u?.avatarUrl as string | null) ?? null,
      twoFaEnabled: !!u?.twoFaEnabled,
      announcementCount: Number((annRes.rows[0] as any)?.n ?? 0),
      // Published release notes this user hasn't opened yet — drives the
      // "what's new" sparkle badge so shipped features get discovered.
      whatsNewUnread: Number((whatsNewRes.rows[0] as any)?.n ?? 0),
    };
  });

  // Firm-wide layout defaults (owner-set) — injected as a global so the
  // RelatedLists + ColumnManager components can use them as the fallback before
  // a user personalizes (their own localStorage choice still wins).
  const firmLayoutRows = await withTenant(session.tenantId, async (tx) =>
    tx
      .select({ moduleKey: tenantUiLayouts.moduleKey, kind: tenantUiLayouts.kind, data: tenantUiLayouts.data })
      .from(tenantUiLayouts)
      .where(eq(tenantUiLayouts.tenantId, session.tenantId))
  );
  const firmLayoutMap: Record<string, Record<string, any>> = {};
  for (const r of firmLayoutRows) (firmLayoutMap[r.moduleKey] ??= {})[r.kind] = r.data;
  const layoutAdmin = can(session.roles, "settings.users", (session as any).permissions);

  // Sidebar badge uses the square icon variant, falling back to monogram → full
  // logo so a firm that only uploaded a wide logo still gets a sensible badge.
  const sidebarLogo = pickLogo(tenant, "icon");

  // MFD → team sidebar gate. Owners always see the full firm set; everyone else
  // is limited to the items the owner granted them (a subset of the firm's).
  const isOwnerUser = session.roles.includes("owner");
  // Sidebar grant actually in force for this user:
  //   explicit per-user grant  →  role default  →  null ("everything the firm has")
  // The role default is what scopes back office to its five areas. It is applied
  // exactly like an explicit grant — including the server-side navBlocked check
  // below — because hiding an item while leaving its URL reachable is the same
  // UI-only gating that check exists to close.
  const effectiveUserModules = userModules ?? roleDefaultNavKeys(session.roles);

  // The FIRM ADMIN sees every module the product has, full stop.
  //
  // The per-firm sidebar grant (subscriptions.allowed_nav, set in Equitywala
  // Admin -> Module & Field Access Center) is a FROZEN LIST: it stores the exact
  // hrefs that existed when an admin last saved it. Every sidebar item shipped
  // AFTER that save is therefore missing from the list and invisible to the firm
  // forever — which is why Referrals disappeared for firms whose grant predates
  // it, and why Opportunities would have gone the same way. An owner losing a
  // module because of when their firm's row was last touched is never what
  // anyone intends.
  //
  // Suspension is unaffected: tenants.status is a separate gate (license
  // .isRestricted) and still locks a suspended firm down to support + logout.
  // The grant also still applies in full to every NON-owner role, so an owner
  // can keep scoping their own team.
  const navUnrestricted = isOwnerUser;

  // Enforce nav/module access SERVER-SIDE, not just by hiding the sidebar item:
  // if the requested page belongs to a module the firm (or this team member)
  // wasn't granted, block the render. (Audit: UI-only gating was bypassable by
  // typing the URL directly.)
  const gatedKey = gatedNavKeyForPath(pathname);
  const navBlocked =
    !navUnrestricted &&
    gatedKey !== null &&
    (!tenantAllowedSet.has(gatedKey) ||
      (!isOwnerUser && effectiveUserModules !== null && !effectiveUserModules.includes(gatedKey)));

  // Per-tenant white-label theme: override the brand CSS variables from the
  // firm's chosen primary/accent colours (Settings → Appearance). Empty string
  // when the tenant uses the stock Equitywala palette, so we inject nothing.
  const themeCss = buildTenantThemeCss(
    tenant?.primaryColor,
    (tenant as any)?.secondaryColor,
    (tenant as any)?.textColor,
    (tenant as any)?.hoverColor,
    (tenant as any)?.fontFamily,
    (tenant as any)?.uiDensity
  );

  // Global module controls (platform admin): 'disabled' hides a module for every
  // tenant; 'beta' shows a Beta tag. Loaded from platform_settings('modules').
  const moduleControls = await loadModuleControls();

  // Whether the top Dashboards nav shows at all.
  //
  // `/dashboard` is in CORE_HREFS ("never gated — always accessible regardless of
  // grants") and is where every login lands, so it must ALWAYS be reachable from
  // the sidebar. Only the platform admin's explicit Module Control kill-switch
  // may hide it. The sub-items (My Dashboards / Team Dashboard / Team Scorecard)
  // stay individually gated below via dashSubGated() — when they're all withheld
  // the nav simply collapses to the single Dashboard link.
  //
  // This used to ALSO require `license.enabledModules.includes("dashboards")` and
  // at least one granted sub-item. Both were wrong: "dashboards" is not a real
  // module key in the nav catalog (so that clause could never be true once a
  // tenant had a package with modules), and the core /dashboard was never part of
  // the group check. Any firm on an explicit nav grant therefore lost the
  // Dashboard link from the sidebar entirely, while /dashboard remained their
  // landing page.
  const showDashboards = moduleControls["/dashboard"] !== "disabled";

  const visible = NAV.map((section) => ({
    ...section,
    items: section.items.filter((i) => {
      // Platform kill-switch — a globally-disabled sidebar item is hidden for everyone.
      if (moduleControls[i.href] === "disabled") return false;
      if (i.roles && !session.roles.some((r) => i.roles!.includes(r) || r === "owner")) return false;
      if (isGatableNav(i.href) && !navUnrestricted) {
        // Admin → MFD: the firm must have access to this sidebar item.
        if (!tenantAllowedSet.has(i.href)) return false;
        // MFD → team: owners see all; others limited to their granted items.
        if (!isOwnerUser && effectiveUserModules && !effectiveUserModules.includes(i.href)) return false;
      }
      return true;
    }),
  })).filter((s) => s.items.length > 0);

  // Flatten the role/module-filtered nav into items the client CustomizableNav
  // can reorder/regroup. Pass the icon by NAME (lucide displayName) — a string —
  // not a pre-rendered element, so React never tries to serialize a lucide
  // component across the RSC boundary. The section title is the default group.
  const flatNavItems: NavItemData[] = visible.flatMap((section) =>
    section.items.map((item) => ({
      href: item.href,
      label: item.label,
      iconName: (item.icon?.displayName || item.icon?.name || "") as string,
      defaultGroup: section.title,
      badge: item.href === "/dashboard/announcements" && announcementCount > 0 ? announcementCount : undefined,
      beta: moduleControls[item.href] === "beta",
    }))
  );

  // Sub-items for the top "Dashboards" dropdown. The main /dashboard is the core
  // landing (always present). The rest (My Dashboards, Team Dashboard, Team
  // Scorecard) are now gated exactly like main-nav items — a platform Module
  // Control kill-switch, the per-tenant sidebar grant, and the per-user module
  // set all apply (so an admin can enable/disable each from Module Controls,
  // the package/tenant sidebar grant, or a team member's access).
  const canSeeTeam = session.roles.some((r) => r === "owner" || r === "branch_head");
  const dashSubGated = (href: string): boolean => {
    if (moduleControls[href] === "disabled") return false;
    if (isGatableNav(href) && !navUnrestricted) {
      if (!tenantAllowedSet.has(href)) return false;
      if (!isOwnerUser && effectiveUserModules && !effectiveUserModules.includes(href)) return false;
    }
    return true;
  };
  const dashboardSubItems = [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/dashboard/boards", label: "My Dashboards" },
    ...(canSeeTeam
      ? [
          { href: "/dashboard/team", label: "Team Dashboard" },
          { href: "/dashboard/team/scorecard", label: "Team Scorecard" },
        ]
      : []),
  ].filter((it) => it.href === "/dashboard" || dashSubGated(it.href));

  const roleLabel = primaryRoleLabel(session.roles);

  const initials = session.name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  // Sidebar inner content — brand header + nav + user card. Rendered in BOTH
  // the desktop aside and the mobile drawer (MobileNav), so the navigation has
  // a single source of truth and never drifts between the two.
  const sidebarInner = (
    <>
        {/* Brand header — light neutral row; tenant identity carried by the logo tile only. */}
        <div className="border-b border-border bg-card">
          <div className="sidebar-brand-row px-5 h-16 flex items-center gap-3">
            {tenant ? (
              <>
                {sidebarLogo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={sidebarLogo}
                    alt="logo"
                    className="size-10 rounded-xl ring-1 ring-border object-cover"
                  />
                ) : (
                  <div
                    className="size-10 rounded-xl bg-secondary text-brand-navy grid place-items-center text-lg font-extrabold ring-1 ring-border"
                    style={tenant.primaryColor ? { color: tenant.primaryColor } : {}}
                  >
                    {(tenant.displayName ?? "A").charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="sidebar-brand-text min-w-0">
                  <div className="font-semibold tracking-tight truncate text-sm leading-tight text-foreground">
                    {tenant.displayName ?? "Equitywala"}
                  </div>
                  <div className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-muted-foreground font-mono">
                    <span className="size-1.5 rounded-full bg-emerald-500" />
                    <span className="truncate">{tenant.arn ?? "—"}</span>
                  </div>
                </div>
              </>
            ) : (
              // No tenant context → product default: the Equitywala wordmark on a white card.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src="/equitywala-wordmark.png"
                alt="Equitywala"
                className="h-8 w-auto"
              />
            )}
          </div>
        </div>

        {/* Nav — searchable, user-personalizable (reorder + custom groups) */}
        <CustomizableNav
          items={flatNavItems}
          storageKey={`ssit:nav:${session.userId}`}
          dashboardSubItems={dashboardSubItems}
          showDashboards={showDashboards}
        />

    </>
  );

  return (
    <ToastProvider>
      {/* Per-tenant theme override — re-declares the brand CSS variables on
          :root. Rendered after globals.css in document order, so it wins. */}
      {themeCss && (
        <style id="tenant-theme" dangerouslySetInnerHTML={{ __html: themeCss }} />
      )}
      {/* Firm-wide layout defaults + whether this user can save them. Read
          synchronously by RelatedLists/ColumnManager — no extra fetch, no flash. */}
      <script
        dangerouslySetInnerHTML={{
          __html: `window.__SSIT_FIRM_LAYOUTS__=${JSON.stringify(firmLayoutMap)};window.__SSIT_LAYOUT_ADMIN__=${layoutAdmin ? "true" : "false"};`,
        }}
      />
    {/* h-screen + overflow-hidden on the outer wrapper means the page itself
        never scrolls — the sidebar and the main pane each get their own
        scrollbar from the `overflow-y-auto` they already declare. Print mode
        reverts to block flow so the whole document prints in one stream. */}
    <div className="h-screen flex bg-background overflow-hidden print:block print:h-auto print:overflow-visible">
      {/* ───────────── Desktop sidebar (hidden below lg — mobile uses drawer) ─────────────
          Hover-expand + click-to-pin icon rail. State lives in DesktopSidebar. */}
      <DesktopSidebar>{sidebarInner}</DesktopSidebar>

      {/* ────────────────────────── Main ────────────────────────── */}
      {/* h-full + overflow-y-auto = independent scroll, sticky topbar stays
          pinned inside this pane (not at viewport top). */}
      <main className="flex-1 h-full overflow-y-auto print:overflow-visible print:h-auto">
        {/* Topbar — glass, sticky; hidden when printing */}
        <div className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-xl backdrop-saturate-150 px-4 sm:px-6 h-16 flex items-center justify-between gap-2 sm:gap-4 print:hidden">
          <div className="flex items-center gap-3 min-w-0">
            {/* Mobile hamburger — opens the nav drawer (shares sidebarInner).
                Firm name + ARN live in the sidebar header only (no duplication). */}
            <MobileNav>{sidebarInner}</MobileNav>
          </div>
          <div data-tour="global-search" className="flex-1 min-w-0 flex">
            <GlobalSearch />
          </div>
          <div className="flex items-center gap-2 sm:gap-3 text-sm">
            {/* Convenience icons collapse on phones — everything stays reachable
                (2FA via Settings, Help via pages, birthdays via My Day). */}
            <div className="hidden sm:flex items-center gap-3">
            {/* Two-factor authentication — amber nudge when off, calm when on. */}
            <Link
              href="/dashboard/settings/security"
              className={`size-9 rounded-full grid place-items-center transition-colors ${
                twoFaEnabled
                  ? "bg-secondary/70 hover:bg-secondary text-muted-foreground hover:text-foreground"
                  : "bg-amber-100 hover:bg-amber-200 text-amber-700"
              }`}
              aria-label="Two-factor authentication"
              title={twoFaEnabled ? "Two-factor authentication is on" : "Enable two-factor authentication (2FA)"}
            >
              {twoFaEnabled ? <ShieldCheck className="size-4" /> : <ShieldAlert className="size-4" />}
            </Link>
            <Link
              href="/dashboard/help"
              className="size-9 rounded-full bg-secondary/70 hover:bg-secondary text-muted-foreground hover:text-foreground grid place-items-center transition-colors"
              aria-label="Help and glossary"
              title="Help & glossary — explanations for ARN, KYC, NAV and more"
            >
              <HelpCircle className="size-4" />
            </Link>
            <WhatsNewBell unread={whatsNewUnread} />
            <BirthdayBell />
            </div>
            <span data-tour="notifications" className="inline-flex">
              <NotificationBell />
            </span>
            <span className="hidden sm:block h-6 w-px bg-border mx-0.5" />
            <ProfileMenu
              name={session.name}
              email={session.email}
              roleLabel={roleLabel}
              initials={initials}
              avatarUrl={avatarUrl}
            />
          </div>
        </div>
        {/* pb-24 on phones keeps the floating + button clear of the last row/link. */}
        <div className="dashboard-content p-4 pb-24 sm:p-6 sm:pb-6 animate-fade-in print:p-0 print:animate-none">
          {navBlocked ? (
            <NavBlockedNotice />
          ) : (
            <>
              {children}
              <SessionRegister />
            </>
          )}
        </div>
      </main>
      {/* Floating quick-create button — bottom-right. Lets users add a lead,
          client, task, meeting, proposal or service request from anywhere
          without hunting through the sidebar. */}
      <QuickCreateFab />
      {/* Ctrl/⌘-K command palette — jump to any module, quick-create, or search
          records. Gets the same role/license-filtered nav as the sidebar. */}
      <CommandPalette navItems={flatNavItems} />
      {/* First-run coachmark tour — runs once, spotlighting nav, search, Ctrl+K,
          quick-create and notifications so a new user isn't overwhelmed. */}
      <ProductTour />
    </div>
    </ToastProvider>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
