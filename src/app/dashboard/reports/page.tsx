import Link from "next/link";
import { BarChart3 } from "lucide-react";
import { ReportsGrid } from "@/components/reports/ReportsGrid";
import { HelpTip } from "@/components/common/HelpTip";

/**
 * Canned report catalog. `icon` is a lucide displayName (string) so the list
 * can be handed to the client <ReportsGrid> (which owns per-user hide/restore)
 * without serializing icon components across the RSC boundary.
 *
 * `href` defaults to /dashboard/reports/<key>; set it explicitly when a report
 * routes to a dedicated page elsewhere (e.g. DDQ readiness → /dashboard/compliance).
 */
type ReportItem = { key: string; label: string; icon: string; href?: string; desc?: string };

const REPORTS: { group: string; items: ReportItem[] }[] = [
  {
    group: "Growth MIS (Monthly)", items: [
      { key: "growth_mis", label: "Growth MIS — Efforts × Results", icon: "BarChart3", href: "/dashboard/reports/growth-mis", desc: "Monthly efforts and results, side by side" },
      { key: "business_mis", label: "Results MIS — Product × Asset (Full FY)", icon: "BarChart3", href: "/dashboard/reports/business-mis", desc: "Full-year business by product and asset class" },
    ]
  },
  {
    group: "Sales & Business", items: [
      { key: "daily_sip_added", label: "Daily SIP Added", icon: "TrendingUp", desc: "New SIPs registered, day by day" },
      { key: "daily_lumpsum", label: "Daily Purchase", icon: "TrendingUp", desc: "Lumpsum purchases, day by day" },
      { key: "redemption", label: "Daily Redemption", icon: "TrendingDown", desc: "Money leaving the book, day by day" },
      { key: "net_sales", label: "Net Business", icon: "BarChart3", desc: "Inflows minus outflows for the period" },
      { key: "net_sales_platform", label: "Net Sales by Platform", icon: "BarChart3", href: "/dashboard/reports/net-sales", desc: "Net sales split by BSE/NSE/direct platform" },
      { key: "efforts", label: "Efforts — Plan vs Actual", icon: "ListChecks", href: "/dashboard/reports/efforts", desc: "Calls, meetings and proposals vs your plan" },
      { key: "amc_business", label: "AMC-wise Business", icon: "BarChart3", desc: "Which fund houses your business goes to" },
      { key: "scheme_category_business", label: "Scheme Category-wise", icon: "BarChart3", desc: "Business split by equity, debt, hybrid" },
      { key: "aum_movement", label: "AUM Movement", icon: "BarChart3", desc: "How your AUM grew or shrank" },
      { key: "equity_team", label: "Equity Team (Direct Equity) — Planned vs Actual", icon: "TrendingUp", href: "/dashboard/reports/equity-team", desc: "Direct-equity desk: planned vs delivered" },
    ]
  },
  {
    group: "SIP Tracker", items: [
      { key: "active_sip_book", label: "Active SIP Book", icon: "BarChart3", desc: "Every live SIP and its monthly value" },
      { key: "sip_added_mtd", label: "SIP Added This Month", icon: "TrendingUp", desc: "SIPs started this month" },
      { key: "sip_stopped", label: "SIP Stopped This Month", icon: "TrendingDown", desc: "SIPs stopped this month, with reasons" },
      { key: "sip_expiring", label: "SIP Expiring Soon", icon: "Calendar", desc: "SIPs about to end — renew in time" },
      { key: "sip_topup_opportunity", label: "SIP Top-Up Opportunity", icon: "TrendingUp", desc: "Clients who can raise their SIP" },
      { key: "sip_health", label: "SIP Health & Efforts", icon: "TrendingUp", href: "/dashboard/reports/sip-health", desc: "Bounce trends and recovery efforts" },
      { key: "rm_sip_book", label: "RM-wise SIP Book", icon: "Users", desc: "Each RM's SIP book size" },
      { key: "sip_book_size", label: "SIP Book Size (branch-wise)", icon: "BarChart3", href: "/dashboard/reports/metric/sip-book", desc: "SIP book totals by branch" },
      { key: "sip_rejected", label: "SIP Rejected", icon: "AlertTriangle", desc: "SIPs that bounced and need recovery" },
      { key: "sip_recovery_monthly", label: "Monthly SIP Recovery", icon: "TrendingUp", desc: "Bounced SIPs recovered each month" },
    ]
  },
  {
    group: "Team & Branch", items: [
      { key: "rm_business", label: "RM-wise Business", icon: "Users", desc: "Business brought in by each RM" },
      { key: "rm_clients", label: "RM-wise Clients", icon: "Users", desc: "How many clients each RM manages" },
      { key: "rm_reviews", label: "RM-wise Reviews", icon: "Calendar", desc: "Review meetings held by each RM" },
      { key: "rm_pending", label: "RM-wise Pending Work", icon: "AlertTriangle", desc: "Open work sitting with each RM" },
      { key: "employee_tasks", label: "Employee-wise Tasks", icon: "Users", desc: "Task load and completion by teammate" },
      { key: "branch_business", label: "Branch-wise Business", icon: "Briefcase", desc: "Business by branch" },
      { key: "aum_status", label: "AUM Status (branch-wise)", icon: "BarChart3", href: "/dashboard/reports/metric/aum", desc: "AUM totals by branch" },
      { key: "team_productivity", label: "Team Productivity", icon: "Users", desc: "Activity and output across the team" },
    ]
  },
  {
    group: "Branch & RM Business (Monthly)", items: [
      { key: "sif_status", label: "SIF Business — Target vs Actual", icon: "TrendingUp", href: "/dashboard/reports/sif-status", desc: "SIF business vs target, monthly" },
      { key: "branch_rm_sip", label: "SIP — Branch & RM-wise", icon: "TrendingUp", href: "/dashboard/reports/branch-rm/sip", desc: "SIP numbers by branch and RM" },
      { key: "branch_rm_equity", label: "Equity Lumpsum — Branch & RM-wise", icon: "BarChart3", href: "/dashboard/reports/branch-rm/equity-lumpsum", desc: "Equity lumpsum by branch and RM" },
      { key: "branch_rm_liquid", label: "Liquid Lumpsum — Branch & RM-wise", icon: "BarChart3", href: "/dashboard/reports/branch-rm/liquid-lumpsum", desc: "Liquid lumpsum by branch and RM" },
      { key: "branch_rm_insurance", label: "Insurance — Branch & RM-wise", icon: "ShieldCheck", href: "/dashboard/reports/branch-rm/insurance", desc: "Insurance business by branch and RM" },
      { key: "redemption_by_client", label: "Redemption by Client", icon: "TrendingDown", href: "/dashboard/reports/redemption", desc: "Who redeemed, how much, and when" },
      { key: "sip_rejection", label: "SIP Rejection / Pending / Repurchase", icon: "AlertTriangle", href: "/dashboard/reports/sip-rejection", desc: "Bounces, pending recoveries and repurchases" },
    ]
  },
  {
    group: "Lead Blueprint", items: [
      { key: "lead_funnel", label: "Lead Funnel & Conversion (Source × RM)", icon: "Filter", href: "/dashboard/reports/lead-funnel", desc: "Where leads come from and who converts them" },
      { key: "blueprint_drop_off", label: "Lead Drop-off Analysis", icon: "TrendingDown", desc: "Which stage loses the most leads" },
      { key: "blueprint_lost_reasons", label: "Lead Loss Reasons", icon: "Filter", desc: "Why leads say no" },
      { key: "blueprint_delayed_leads", label: "SLA-overdue Leads", icon: "AlertTriangle", desc: "Leads stuck past their stage deadline" },
      { key: "blueprint_pipeline_by_rm", label: "RM-wise Blueprint Pipeline", icon: "Users", desc: "Each RM's lead pipeline right now" },
    ]
  },
  {
    group: "Clients", items: [
      { key: "lead_conversion", label: "Lead Conversion", icon: "Filter", desc: "Leads that became clients" },
      { key: "review_pending", label: "Review Pending", icon: "Calendar", desc: "Clients waiting for a portfolio review" },
      { key: "service_pending", label: "Service Requests Pending", icon: "FileText", desc: "Open service requests by age" },
      { key: "segmentation", label: "Client Segmentation", icon: "Users", desc: "Your book by segment — HNI, retail, NRI" },
      { key: "high_aum", label: "High-AUM Clients", icon: "TrendingUp", desc: "Your largest clients at a glance" },
      { key: "dormant", label: "Dormant Clients", icon: "AlertTriangle", desc: "Clients with no activity for months" },
      { key: "nomination-tracker", label: "Nomination Tracker", icon: "ShieldCheck", desc: "Folios still missing a nominee" },
    ]
  },
  {
    group: "Retention & Tax", items: [
      { key: "churn-risk", label: "Churn-risk radar", icon: "ShieldCheck", desc: "Clients showing signs of leaving" },
      { key: "tax-harvesting", label: "Tax-harvesting", icon: "TrendingUp", desc: "Gains that can be booked tax-smart" },
      { key: "cross-sell", label: "Cross-sell Radar", icon: "Users", desc: "Who's missing SIP, insurance or ELSS" },
    ]
  },
  {
    group: "Practice Intelligence", items: [
      { key: "impact-attribution", label: "Impact Attribution — Protected & Generated Business", icon: "TrendingUp", desc: "Business you protected and generated" },
      { key: "risk-drift", label: "Risk-Drift Radar", icon: "ShieldCheck", desc: "Portfolios drifting from their risk profile" },
      { key: "referral-radar", label: "Referral Radar", icon: "Users", desc: "Who referred, who's likely to refer" },
      { key: "revenue-intelligence", label: "Revenue Intelligence", icon: "TrendingUp", desc: "Where your revenue actually comes from" },
      { key: "trail-forecast", label: "Trail Forecast", icon: "TrendingUp", desc: "Projected trail income, month by month" },
    ]
  },
  {
    group: "Complaint Register (SEBI)", items: [
      { key: "open_complaints", label: "Open Complaints", icon: "AlertTriangle", desc: "Complaints still open (SEBI register)" },
      { key: "resolved_complaints", label: "Resolved Complaints", icon: "CheckCircle2", desc: "Complaints closed, with resolution time" },
      { key: "complaint_tat", label: "Complaint TAT Report", icon: "Clock", desc: "How fast complaints get resolved" },
      { key: "complaint_category", label: "Complaint Category Report", icon: "Shield", desc: "What clients complain about most" },
    ]
  },
  {
    group: "Family Mapping", items: [
      { key: "family_aum", label: "Family-wise AUM", icon: "Users", desc: "Wealth grouped by family" },
      { key: "family_sip", label: "Family-wise SIP", icon: "TrendingUp", desc: "SIPs grouped by family" },
      { key: "unmapped_family_members", label: "Unmapped Family Members", icon: "AlertTriangle", desc: "Clients not linked to any family" },
      { key: "family_review_due", label: "Family Review Due", icon: "Calendar", desc: "Families due for their review" },
      { key: "next_gen_prospects", label: "Next-Gen Prospect List", icon: "Users", desc: "Children of clients — tomorrow's investors" },
    ]
  },
  {
    group: "Goal Planning", items: [
      { key: "goal_clients", label: "Goal-wise Clients", icon: "Users", desc: "Clients and the goals they're planning" },
      { key: "goals_behind", label: "Goals Behind Track", icon: "AlertTriangle", desc: "Goals off-track and by how much" },
      { key: "goals_5yr", label: "Goals Due in Next 5 Years", icon: "Calendar", desc: "Goals maturing in the next five years" },
      { key: "retirement_clients", label: "Retirement Planning Clients", icon: "TrendingUp", desc: "Everyone planning retirement with you" },
      { key: "child_edu_clients", label: "Child Education Planning", icon: "Users", desc: "Everyone planning a child's education" },
    ]
  },
  {
    group: "Marketing Campaigns", items: [
      { key: "campaign_leads", label: "Campaign-wise Leads", icon: "Users", desc: "Leads each campaign brought in" },
      { key: "campaign_conversion", label: "Campaign-wise Conversion", icon: "TrendingUp", desc: "Which campaigns turn into business" },
      { key: "marketing_calendar", label: "Monthly Marketing Calendar", icon: "Calendar", desc: "What goes out this month" },
      { key: "pending_approval_content", label: "Pending Approval Content", icon: "FileText", desc: "Content waiting for compliance sign-off" },
      { key: "marketing-assets", label: "Marketing assets & trust builders", icon: "Megaphone", desc: "Brochures, decks and trust builders" },
    ]
  },
  {
    group: "Insurance", items: [
      { key: "insurance_production", label: "Advisor Production (Personal + Commercial)", icon: "ShieldCheck", href: "/dashboard/reports/insurance-production", desc: "Policies sold — personal and commercial" },
      { key: "insurance_claims", label: "Claims Summary", icon: "ShieldCheck", href: "/dashboard/reports/insurance-claims", desc: "Claims raised and settled" },
    ]
  },
  {
    group: "Back Office (Monthly)", items: [
      { key: "bo_other_services", label: "Other Services (IIN/CAN/KYC…) by Branch", icon: "ListChecks", href: "/dashboard/reports/other-services", desc: "IIN, CAN, KYC and other ops work by branch" },
      { key: "bo_work", label: "Back-Office Work (Rectifications)", icon: "CheckCircle2", href: "/dashboard/reports/back-office-work", desc: "Rectifications handled by back office" },
    ]
  },
  {
    group: "Compliance", items: [
      { key: "ddq_readiness", label: "DDQ Readiness", icon: "FileText", href: "/dashboard/compliance", desc: "How ready you are for a SEBI DDQ" },
      { key: "arn-euin-tracker", label: "ARN / EUIN / NISM / DSC tracker", icon: "Shield", desc: "ARN, EUIN, NISM and DSC expiry dates" },
      { key: "kyc-tracker", label: "Client KYC tracker", icon: "ShieldCheck", desc: "Client KYC status across the book" },
      { key: "shortlisted-schemes", label: "AMC scheme shortlist (IC)", icon: "Briefcase", desc: "Your investment committee's approved list" },
      { key: "suitability-matrix", label: "MF suitability matrix (IC)", icon: "Filter", desc: "Which products suit which risk profile" },
      { key: "mf-selection-criteria", label: "MF selection criteria (IC)", icon: "ListChecks", desc: "How your firm picks funds" },
    ]
  },
  {
    group: "Practice & Finances", items: [
      { key: "business-projections", label: "Business projections (AUM & income)", icon: "TrendingUp", desc: "Where AUM and income are heading" },
      { key: "financial-checklist", label: "Finance management checklist", icon: "CheckCircle2", desc: "Practice finance hygiene, item by item" },
    ]
  },
];

export const dynamic = "force-dynamic";

export default function ReportsPage() {
  const total = REPORTS.reduce((n, g) => n + g.items.length, 0);
  const sections = REPORTS.map((g) => ({
    group: g.group,
    items: g.items.map((i) => ({
      key: i.key,
      label: i.label,
      iconName: i.icon,
      desc: i.desc,
      href: i.href ?? `/dashboard/reports/${i.key}`,
    })),
  }));

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight">Reports &amp; MIS</h1>
          <HelpTip title="Reports & MIS">
            Every MIS and analytics report, grouped by area. Business &amp; SIP numbers, team
            performance, retention &amp; tax, and the new Practice Intelligence reports (risk-drift,
            referrals, revenue).
          </HelpTip>
        </div>
        <Link href="/dashboard/reports/custom" className="btn-primary whitespace-nowrap">
          <BarChart3 className="size-4" /> Custom Reports
        </Link>
      </div>

      <ReportsGrid sections={sections} />
    </div>
  );
}
