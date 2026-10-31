import Link from "next/link";
import { Activity, CalendarCheck, Building2, Database, Users, CreditCard, MessageCircle, Mail, Webhook, ShieldCheck, Workflow, KeyRound, Palette, UserCircle, GitBranch, Target, Network, BellRing, ClipboardCheck, SlidersHorizontal } from "lucide-react";

const SECTIONS = [
  {
    icon: Activity,
    title: "Product readiness",
    desc: "Live, demo, blocked and unavailable services — including launch-critical checks.",
    href: "/dashboard/settings/readiness",
    group: "Workspace",
  },
  {
    icon: UserCircle,
    title: "My profile",
    desc: "Your details, change password, targets & leave entitlements.",
    href: "/dashboard/settings/profile",
    group: "You",
  },
  {
    icon: CalendarCheck,
    title: "My Calendly",
    desc: "Add your Calendly booking link — meetings you schedule here are booked on it too.",
    href: "/dashboard/settings/calendly",
    group: "You",
  },
  {
    icon: Building2,
    title: "Organisation profile",
    desc: "Branding, contact, AUM range, business profile.",
    href: "/dashboard/settings/organisation",
    group: "Workspace",
  },
  {
    icon: Palette,
    title: "Appearance & theme",
    desc: "Re-skin the CRM to your brand — colours, font & density, and your white-label URL.",
    href: "/dashboard/settings/appearance",
    group: "Workspace",
  },
  {
    icon: SlidersHorizontal,
    title: "Custom fields",
    desc: "Add your own fields to leads & clients — text, number, date, dropdown and more.",
    href: "/dashboard/settings/custom-fields",
    group: "Clients & onboarding",
  },
  {
    icon: Database,
    title: "Dropdown options",
    desc: "Edit the choices your team picks from — lead sources, campaign types, service types and more.",
    href: "/dashboard/settings/masters",
    group: "Clients & onboarding",
  },
  {
    icon: ShieldCheck,
    title: "Risk profile questionnaire",
    desc: "Customise questions, scoring, and risk-category bands for your firm.",
    href: "/dashboard/settings/risk-profile",
    group: "Clients & onboarding",
  },
  {
    icon: Workflow,
    title: "Stages & journeys",
    desc: "Edit the stages, deadlines, required fields and automations for leads, service requests, complaints, SIP recovery and reviews.",
    href: "/dashboard/settings/blueprints",
    group: "Automation",
  },
  {
    icon: BellRing,
    title: "Notification templates",
    desc: "Edit the 18 lead-journey templates — welcome, referral, meeting, proposal, docs, portal.",
    href: "/dashboard/settings/notification-templates",
    group: "Automation",
  },
  {
    icon: ClipboardCheck,
    title: "Onboarding form fields",
    desc: "Choose which client account-opening / KYC fields your team MUST fill — make any field mandatory or optional.",
    href: "/dashboard/settings/onboarding-fields",
    group: "Clients & onboarding",
  },
  {
    icon: Workflow,
    title: "Task templates",
    desc: "Design predefined tasks with sub-task checklists (SOPs) — your team applies them when creating a task.",
    href: "/dashboard/settings/task-templates",
    group: "Automation",
  },
  {
    icon: Users,
    title: "Team & roles",
    desc: "Invite team members, assign roles, manage seats.",
    href: "/dashboard/employees",
  },
  {
    icon: Network,
    title: "Teams within a branch",
    desc: "Group each branch into small teams (desks) and assign RMs — powers the monthly MIS roll-ups.",
    href: "/dashboard/settings/desks",
    group: "Team",
  },
  {
    icon: GitBranch,
    title: "Auto-assignment rules",
    desc: "Route new leads & clients to your team automatically — round-robin or load-balanced.",
    href: "/dashboard/settings/assignment-rules",
    group: "Automation",
  },
  {
    icon: Target,
    title: "Targets & quota",
    desc: "Set monthly business, new-meeting and renewal-meeting targets per team member — track vs achievement.",
    href: "/dashboard/settings/targets",
    group: "Team",
  },
  {
    icon: MessageCircle,
    title: "WhatsApp connection",
    desc: "Your Equitywala WhatsApp number and Meta template approvals.",
    href: "/dashboard/settings/whatsapp",
    group: "Billing & connections",
  },
  {
    icon: Mail,
    title: "Email setup",
    desc: "Sending domain, DKIM, transactional + marketing streams.",
    href: "/dashboard/settings/email",
    group: "Billing & connections",
  },
  {
    icon: KeyRound,
    title: "Two-factor authentication",
    desc: "Add a TOTP authenticator code on top of your password. Self-service for your own account.",
    href: "/dashboard/settings/security",
    group: "You",
  },
  {
    icon: Webhook,
    title: "Integrations",
    desc: "BSE Star MF, CAMS / KFintech feeds, Razorpay, KYC providers.",
    href: "/dashboard/settings/integrations",
    group: "Billing & connections",
  },
];

export const dynamic = "force-dynamic";

const GROUP_ORDER = ["You", "Workspace", "Clients & onboarding", "Automation", "Team", "Billing & connections"];

export default function SettingsPage() {
  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground text-sm">Configure your firm's workspace.</p>
      </div>

      {GROUP_ORDER.map((g) => {
        const cards = SECTIONS.filter((s) => (s.group ?? "Workspace") === g);
        if (cards.length === 0) return null;
        return (
          <section key={g}>
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground mb-2">{g}</h2>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {cards.map((s) => {
                const Icon = s.icon;
                return (
                  <Link
                    key={s.href}
                    href={s.href}
                    className="border rounded-lg p-4 bg-card hover:bg-accent/40 transition-colors flex items-start gap-3"
                  >
                    <Icon className="size-5 text-muted-foreground mt-0.5" />
                    <div className="flex-1">
                      <div className="font-medium">{s.title}</div>
                      <div className="text-xs text-muted-foreground mt-1">{s.desc}</div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
