import Link from "next/link";
import { sql } from "drizzle-orm";
import { Megaphone, Send } from "lucide-react";
import { withTenant } from "@/db/client";
import type { SessionUser } from "@/lib/auth/session";
import { resolvePeriodRange, type Period } from "@/lib/dashboard/period";
import { PeriodSelector } from "./PeriodSelector";
import { DashboardEmptyState } from "./DashboardEmptyState";
import { CampaignRoiChart } from "./CampaignRoiChart";
import { MarketingInsightsSection } from "./MarketingInsightsSection";

/**
 * Marketing dashboard — content + campaign focused.
 * Marketing-only: no lead or lead-source figures live here.
 *   Campaigns this month · Content created (marketing tasks done) · Messages sent
 *   Pending creatives · Content pending approval · Posted content archive
 *   Social media calendar · Event registrations · Webinar follow-ups
 */
export async function MarketingDashboard({
  session,
  period,
  customStart,
}: {
  session: SessionUser;
  period?: Period;
  customStart?: string;
}) {
  const range = resolvePeriodRange(period ?? "mtd", new Date(), { customStart });
  const fromISO = range.fromISO;
  const toISO = range.toISO;

  const data = await withTenant(session.tenantId, async (tx) => {
    const r = await tx.execute(sql`
      SELECT
        (SELECT COUNT(*)::int FROM campaigns WHERE created_at >= ${fromISO} AND created_at <= ${toISO}) AS campaigns_mtd,
        (SELECT COUNT(*)::int FROM campaigns WHERE status IN ('sending', 'scheduled')) AS active_campaigns,
        (SELECT COUNT(*)::int FROM tasks t
          WHERE t.status = 'completed' AND t.completed_at >= ${fromISO} AND t.completed_at <= ${toISO}
            AND (t.department = 'marketing'
                 OR EXISTS (SELECT 1 FROM users u WHERE u.id = t.assignee_id AND 'marketing' = ANY(u.roles)))) AS content_done,
        (SELECT COALESCE(SUM(sent_count), 0)::int FROM campaigns WHERE created_at >= ${fromISO} AND created_at <= ${toISO}) AS sent_mtd,
        (SELECT COUNT(*)::int FROM templates WHERE status = 'pending_approval' AND category = 'marketing') AS pending_approval
    `);
    const s = r.rows[0] as any;

    const campaignsList = await tx.execute(sql`
      SELECT id, name, channel, status, total_recipients, sent_count, delivered_count, read_count, replied_count, scheduled_at, started_at
      FROM campaigns
      WHERE created_at >= ${fromISO} AND created_at <= ${toISO}
      ORDER BY created_at DESC
      LIMIT 8
    `);

    return {
      campaignsMtd: Number(s.campaigns_mtd),
      activeCampaigns: Number(s.active_campaigns),
      contentDone: Number(s.content_done),
      sentMtd: Number(s.sent_mtd),
      pendingApproval: Number(s.pending_approval),
      campaigns: campaignsList.rows as any[],
    };
  }, { userId: session.userId, branchId: session.branchId, roles: session.roles });

  const campaignRoiData = data.campaigns.slice(0, 5).map((c) => ({
    name: c.name.length > 15 ? c.name.slice(0, 15) + "..." : c.name,
    sent: Number(c.sent_count ?? 0),
    read: Number(c.read_count ?? 0),
    replied: Number(c.replied_count ?? 0),
  }));

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Marketing dashboard</h1>
          <p className="text-muted-foreground text-sm">
            Campaigns and content · <span className="font-medium">{range.label}</span>
          </p>
        </div>
        <PeriodSelector current={period ?? "mtd"} variant="light" />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <Kpi label="Campaigns" value={String(data.campaignsMtd)} />
        <Kpi label="Active right now" value={String(data.activeCampaigns)} />
        <Kpi label="Content created" value={String(data.contentDone)} />
        <Kpi label="Messages sent" value={data.sentMtd.toLocaleString("en-IN")} />
        <Kpi label="Approval queue" value={String(data.pendingApproval)} tone={data.pendingApproval > 0 ? "amber" : "muted"} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Campaign ROI visual */}
        <div className="lg:col-span-3 card-surface glass-card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold flex items-center gap-2 text-sm tracking-tight text-foreground/90">
              <Megaphone className="size-4 text-brand-cyan-deep" /> Campaign ROI Performance
            </h2>
            <Link href="/dashboard/campaigns" className="text-xs text-brand-cyan-deep hover:underline font-semibold">
              Open all →
            </Link>
          </div>
          {data.campaigns.length === 0 ? (
            <DashboardEmptyState
              icon={Megaphone}
              title="No campaigns this period"
              hint="Broadcasts you send in this window will show their reach here."
              cta={{ href: "/dashboard/campaigns/new", label: "Create broadcast" }}
            />
          ) : (
            <CampaignRoiChart data={campaignRoiData} />
          )}
        </div>

      </div>

      {/* Quick Actions */}
      <div className="card-surface glass-card p-5">
        <h2 className="font-semibold flex items-center gap-2 text-sm tracking-tight text-foreground/90 mb-4">
          <Send className="size-4 text-brand-cyan-deep" /> Quick Actions
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Action href="/dashboard/campaigns/new" label="Create broadcast" />
          <Action href="/dashboard/templates/new" label="Create template" />
          <Action href="/dashboard/ssit-library" label="Browse content library" />
        </div>
      </div>

      {/* ---------- Marketing Insights — service & consent additions ---------- */}
      <MarketingInsightsSection session={session} />
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "amber" | "muted" }) {
  const color = tone === "amber" && value !== "0" ? "text-amber-600" : "text-foreground";
  return (
    <div className="card-surface glass-card p-5 hover-lift">
      <div className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">{label}</div>
      <div className={`text-2xl font-bold mt-2 tracking-tight ${color}`}>{value}</div>
    </div>
  );
}

function Action({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="block border rounded-md px-3.5 py-2.5 text-xs bg-card hover:bg-secondary/70 border-border/70 font-semibold transition-all hover:translate-x-1 duration-150 shadow-sm">
      {label}
    </Link>
  );
}
