import Link from "next/link";
import { sql } from "drizzle-orm";
import {
  Plus,
  Megaphone,
  Users,
  Target,
  TrendingUp,
  IndianRupee,
  FileText,
  MessageCircle,
  Mail,
  MessageSquare,
  Globe,
  Share2,
  Video,
  Users2,
  Sparkles,
} from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { formatDate, formatINR } from "@/lib/utils";
import { RowActions } from "@/components/common/RowActions";
import { CompactFilterBar } from "@/components/common/CompactFilterBar";
import { dateRangeCond, dateRangeFilter } from "@/lib/filters/date-range";
import { CustomViews } from "@/components/common/CustomViews";
import { StatusChip, type Tone } from "@/components/common/StatusChip";

const KIND_LABEL: Record<string, string> = {
  social_media: "Social Media",
  whatsapp: "WhatsApp",
  email: "Email",
  sms: "SMS",
  webinar: "Webinar / Seminar",
  seminar: "Webinar / Seminar",
  referral: "Referral",
  google_business: "Google Business",
  paid_ads: "Paid Ads",
  content: "Content",
  other: "Other",
};

const KIND_ICON: Record<string, any> = {
  social_media: Share2,
  whatsapp: MessageCircle,
  email: Mail,
  sms: MessageSquare,
  webinar: Video,
  seminar: Users2,
  referral: Users,
  google_business: Globe,
  paid_ads: Sparkles,
  content: FileText,
  other: Megaphone,
};

const STATUS_TONE: Record<string, Tone> = {
  draft: "neutral",
  scheduled: "info",
  sending: "warning",
  sent: "success",
  paused: "neutral",
  cancelled: "danger",
};

const CONTENT_TONE: Record<string, Tone> = {
  not_started: "neutral",
  drafting: "warning",
  ready: "info",
  published: "success",
};

const COMPLIANCE_TONE: Record<string, Tone> = {
  pending: "warning",
  cleared: "success",
  blocked: "danger",
  not_required: "neutral",
};

const APPROVAL_TONE: Record<string, Tone> = {
  pending: "warning",
  approved: "success",
  rejected: "danger",
  not_required: "neutral",
};

export const dynamic = "force-dynamic";

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  requireCap(session.roles, "campaign.send", session.permissions);
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const kindFilter = (sp.kind ?? "").split(",").filter(Boolean);
  const statusFilter = (sp.status ?? "").split(",").filter(Boolean);
  const approvalFilter = (sp.approval ?? "").split(",").filter(Boolean);
  const complianceFilter = (sp.compliance ?? "").split(",").filter(Boolean);

  const data = await withTenant(session.tenantId, async (tx) => {
    // Explicit tenant predicate (defense-in-depth alongside RLS) — always first.
    const filters: any[] = [sql`c.tenant_id = ${session.tenantId}::uuid`];
    if (q) {
      filters.push(
        sql`(c.name ILIKE ${`%${q}%`} OR c.theme ILIKE ${`%${q}%`} OR c.target_audience ILIKE ${`%${q}%`})`
      );
    }
    if (kindFilter.length) {
      filters.push(
        sql`c.kind IN (${sql.join(kindFilter.map((v) => sql`${v}`), sql`, `)})`
      );
    }
    if (statusFilter.length) {
      filters.push(
        sql`c.status IN (${sql.join(statusFilter.map((v) => sql`${v}`), sql`, `)})`
      );
    }
    if (approvalFilter.length) {
      filters.push(
        sql`c.approval_status IN (${sql.join(approvalFilter.map((v) => sql`${v}`), sql`, `)})`
      );
    }
    if (complianceFilter.length) {
      filters.push(
        sql`c.compliance_check_status IN (${sql.join(complianceFilter.map((v) => sql`${v}`), sql`, `)})`
      );
    }
    const dr = dateRangeCond(sp, "created", "c.created_at");
    if (dr) filters.push(dr);
    const whereSql = filters.length ? sql` WHERE ${sql.join(filters, sql` AND `)}` : sql``;

    const rows = await tx.execute(sql`
      SELECT c.id, c.name, c.kind, c.theme,
             c.start_date, c.end_date,
             c.target_audience,
             c.channel, c.status,
             c.content_status, c.compliance_check_status, c.approval_status,
             c.leads_generated, c.meetings_booked, c.clients_converted,
             c.campaign_cost::numeric AS campaign_cost,
             c.remarks, c.created_at,
             s.name AS segment_name, s.member_count AS segment_size
      FROM campaigns c
      LEFT JOIN segments s ON s.id = c.segment_id
      ${whereSql}
      ORDER BY COALESCE(c.start_date, c.created_at) DESC
      LIMIT 200
    `);

    const stats = await tx.execute(sql`
      SELECT
        COUNT(*) FILTER (
          WHERE (start_date IS NULL OR start_date <= now())
            AND (end_date IS NULL OR end_date >= now())
            AND status NOT IN ('cancelled')
        )::int AS active,
        COUNT(*) FILTER (WHERE created_at >= date_trunc('year', now()))::int AS ytd_count,
        COALESCE(SUM(leads_generated) FILTER (WHERE created_at >= date_trunc('year', now())), 0)::int AS ytd_leads,
        COALESCE(SUM(meetings_booked) FILTER (WHERE created_at >= date_trunc('year', now())), 0)::int AS ytd_meetings,
        COALESCE(SUM(clients_converted) FILTER (WHERE created_at >= date_trunc('year', now())), 0)::int AS ytd_conversions,
        COALESCE(SUM(campaign_cost::numeric) FILTER (WHERE created_at >= date_trunc('year', now())), 0)::numeric AS ytd_cost,
        COUNT(*) FILTER (WHERE approval_status = 'pending')::int AS pending_approval
      FROM campaigns
      WHERE tenant_id = ${session.tenantId}::uuid
    `);
    return { rows: rows.rows as any[], s: stats.rows[0] as any };
  });

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Megaphone className="size-6 text-brand-cyan" /> Marketing Campaigns
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/dashboard/reports/campaign_conversion" className="btn-secondary text-xs">
            <FileText className="size-3.5" /> Conversion report
          </Link>
          <Link href="/dashboard/campaigns/new" className="btn-primary">
            <Plus className="size-4" /> New campaign
          </Link>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-6 gap-3">
        <Link href="/dashboard/campaigns?status=scheduled,sending,sent" className="block transition-transform hover:scale-[1.01]">
          <Stat icon={Megaphone} label="Active" value={data.s.active ?? 0} tone="emerald" active={sp.status === "scheduled,sending,sent"} />
        </Link>
        <div className="block">
          <Stat icon={Users} label="Leads (YTD)" value={data.s.ytd_leads ?? 0} />
        </div>
        <div className="block">
          <Stat icon={Target} label="Meetings (YTD)" value={data.s.ytd_meetings ?? 0} />
        </div>
        <div className="block">
          <Stat icon={TrendingUp} label="Conversions (YTD)" value={data.s.ytd_conversions ?? 0} tone="emerald" />
        </div>
        <div className="block">
          <Stat
            icon={IndianRupee}
            label="Spend (YTD)"
            value={data.s.ytd_cost ? formatINR(Number(data.s.ytd_cost)) : "₹0"}
          />
        </div>
        <Link href="/dashboard/campaigns?approval=pending" className="block transition-transform hover:scale-[1.01]">
          <Stat
            icon={FileText}
            label="Pending approval"
            value={data.s.pending_approval ?? 0}
            tone={Number(data.s.pending_approval) > 0 ? "amber" : "muted"}
            active={sp.approval === "pending"}
          />
        </Link>
      </div>

      <CompactFilterBar
        totalCount={data.rows.length}
        filters={[
          { type: "search", key: "q", placeholder: "Search by campaign, theme, audience…" },
          {
            type: "multi",
            key: "kind",
            label: "Type",
            options: [
              { value: "whatsapp", label: "WhatsApp" },
              { value: "email", label: "Email" },
              { value: "webinar", label: "Webinar / Seminar" },
            ],
          },
          {
            type: "multi",
            key: "status",
            label: "Status",
            options: [
              { value: "draft", label: "Draft" },
              { value: "scheduled", label: "Scheduled" },
              { value: "sending", label: "Sending" },
              { value: "sent", label: "Sent" },
              { value: "paused", label: "Paused" },
              { value: "cancelled", label: "Cancelled" },
            ],
          },
          {
            type: "multi",
            key: "approval",
            label: "Approval",
            options: [
              { value: "pending", label: "Pending" },
              { value: "approved", label: "Approved" },
              { value: "rejected", label: "Rejected" },
              { value: "not_required", label: "Not required" },
            ],
          },
          {
            type: "multi",
            key: "compliance",
            label: "Compliance",
            options: [
              { value: "pending", label: "Pending" },
              { value: "cleared", label: "Cleared" },
              { value: "blocked", label: "Blocked" },
              { value: "not_required", label: "Not required" },
            ],
          },
          dateRangeFilter("created", "Created"),
        ]}
        rightSlot={
          <CustomViews
            viewsKey="views:campaigns"
            presets={[
              { id: "active", name: "Active", params: "status=scheduled,sending,sent" },
              { id: "awaiting", name: "Awaiting approval", params: "approval=pending" },
              { id: "blocked", name: "Compliance blocked", params: "compliance=blocked" },
              { id: "whatsapp", name: "WhatsApp only", params: "kind=whatsapp" },
              { id: "events", name: "Events", params: "kind=webinar" },
            ]}
          />
        }
      />

      <div className="card-surface">
        {data.rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            <Megaphone className="size-8 mx-auto text-muted-foreground/50" />
            <div className="mt-2 font-medium">No campaigns yet.</div>
            <p className="mt-2 text-xs max-w-md mx-auto">
              Click <strong>New campaign</strong> to log a webinar, seminar, paid-ads burst, or
              schedule a WhatsApp / email broadcast.
            </p>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b sticky top-0 z-10 bg-card">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Campaign</th>
                  <th className="text-left py-2 font-medium">Type</th>
                  <th className="text-left py-2 font-medium">Theme</th>
                  <th className="text-left py-2 font-medium">Window</th>
                  <th className="text-left py-2 font-medium">Audience</th>
                  <th className="text-left py-2 font-medium">Content</th>
                  <th className="text-left py-2 font-medium">Compliance</th>
                  <th className="text-left py-2 font-medium">Approval</th>
                  <th className="text-right py-2 font-medium">Leads</th>
                  <th className="text-right py-2 font-medium">Meetings</th>
                  <th className="text-right py-2 font-medium">Conv.</th>
                  <th className="text-right py-2 font-medium">Cost</th>
                  <th className="text-left py-2 font-medium">Remarks</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((c) => {
                  const Icon = KIND_ICON[c.kind ?? c.channel ?? "other"] ?? Megaphone;
                  return (
                    <tr key={c.id} className="border-b last:border-0 hover:bg-secondary/40">
                      <td className="px-4 py-3">
                        <Link
                          href={`/dashboard/campaigns/${c.id}`}
                          className="font-medium hover:underline"
                        >
                          {c.name}
                        </Link>
                        <div className="mt-0.5">
                          <StatusChip tone={STATUS_TONE[c.status] ?? "neutral"} className="text-[10px]">
                            {c.status}
                          </StatusChip>
                        </div>
                      </td>
                      <td className="py-3">
                        <div className="flex items-center gap-1.5 text-xs">
                          <Icon className="size-3.5 text-muted-foreground" />
                          <span>{KIND_LABEL[c.kind ?? c.channel] ?? c.kind ?? c.channel}</span>
                        </div>
                      </td>
                      <td className="py-3 text-xs">{c.theme ?? "—"}</td>
                      <td className="py-3 text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                        {c.start_date ? formatDate(c.start_date) : "—"}
                        {c.end_date && (
                          <>
                            <br />
                            <span className="text-[11px]">→ {formatDate(c.end_date)}</span>
                          </>
                        )}
                      </td>
                      <td className="py-3 text-xs">
                        {c.segment_name ? (
                          <>
                            <div className="font-medium">{c.segment_name}</div>
                            <div className="text-[11px] text-muted-foreground">
                              {c.segment_size ?? 0} members
                            </div>
                          </>
                        ) : (
                          <span className="text-muted-foreground">
                            {c.target_audience ?? "—"}
                          </span>
                        )}
                      </td>
                      <td className="py-3">
                        <StatusChip tone={CONTENT_TONE[c.content_status] ?? "neutral"}>
                          {(c.content_status ?? "—").replace(/_/g, " ")}
                        </StatusChip>
                      </td>
                      <td className="py-3">
                        <StatusChip tone={COMPLIANCE_TONE[c.compliance_check_status] ?? "neutral"}>
                          {(c.compliance_check_status ?? "—").replace(/_/g, " ")}
                        </StatusChip>
                      </td>
                      <td className="py-3">
                        <StatusChip tone={APPROVAL_TONE[c.approval_status] ?? "neutral"}>
                          {(c.approval_status ?? "—").replace(/_/g, " ")}
                        </StatusChip>
                      </td>
                      <td className="py-3 text-right tabular-nums">{c.leads_generated ?? 0}</td>
                      <td className="py-3 text-right tabular-nums">{c.meetings_booked ?? 0}</td>
                      <td className="py-3 text-right tabular-nums text-emerald-600 font-medium">
                        {c.clients_converted ?? 0}
                      </td>
                      <td className="py-3 text-right tabular-nums text-muted-foreground">
                        {c.campaign_cost ? formatINR(Number(c.campaign_cost)) : "—"}
                      </td>
                      <td className="py-3 text-xs text-muted-foreground max-w-[160px] truncate">
                        {c.remarks ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <RowActions
                          editHref={`/dashboard/campaigns/${c.id}`}
                          deleteUrl={`/api/campaigns/${c.id}`}
                          itemLabel="campaign"
                          itemName={c.name}
                          verb={c.status === "sending" ? undefined : "Cancel"}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  icon: Icon,
  active,
}: {
  label: string;
  value: number | string;
  tone?: "rose" | "amber" | "emerald" | "muted";
  icon?: any;
  active?: boolean;
}) {
  const color =
    tone === "rose"
      ? "text-rose-600 font-bold"
      : tone === "amber"
        ? "text-amber-600 font-bold"
        : tone === "emerald"
          ? "text-emerald-600 font-bold"
          : "text-foreground";
  const iconBg =
    tone === "rose"
      ? "bg-rose-50 text-rose-600"
      : tone === "amber"
        ? "bg-amber-50 text-amber-600"
        : tone === "emerald"
          ? "bg-emerald-50 text-emerald-600"
          : "bg-brand-cyan-light text-brand-cyan-deep";
  return (
    <div className={`kpi-card transition-all ${active
        ? "ring-2 ring-primary/65 border-primary bg-slate-50/50 shadow-sm"
        : "hover:border-slate-300 bg-white"
      }`}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
          {label}
        </span>
        {Icon && (
          <div className={`size-7 rounded-lg grid place-items-center ${iconBg}`}>
            <Icon className="size-3.5" />
          </div>
        )}
      </div>
      <div className={`text-2xl font-bold mt-2 tabular-nums tracking-tight ${color}`}>
        {value}
      </div>
    </div>
  );
}
