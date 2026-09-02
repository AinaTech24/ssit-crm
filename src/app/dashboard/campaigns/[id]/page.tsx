import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { ChevronLeft, Send, MessageCircle, Mail, MessageSquare } from "lucide-react";
import { withTenant } from "@/db/client";
import { campaigns, communications, segments, templates } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { isBroadcastCampaign } from "@/lib/campaigns/broadcast";
import { CampaignActions } from "@/components/campaigns/CampaignActions";
import { CampaignRecipients } from "@/components/campaigns/CampaignRecipients";
import { CampaignTestSend } from "@/components/campaigns/CampaignTestSend";
import { CampaignAbResults } from "@/components/campaigns/CampaignAbResults";
import { RecordProvenance } from "@/components/common/RecordProvenance";
import { formatDate } from "@/lib/utils";

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-50 text-gray-700",
  scheduled: "bg-blue-50 text-blue-700",
  sending: "bg-amber-50 text-amber-700",
  sent: "bg-emerald-50 text-emerald-700",
  paused: "bg-slate-50 text-slate-700",
  cancelled: "bg-rose-50 text-rose-700",
};
const ICONS = { whatsapp: MessageCircle, email: Mail, sms: MessageSquare } as any;

export const dynamic = "force-dynamic";

export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  requireCap(session.roles, "campaign.send", session.permissions);
  const data = await withTenant(session.tenantId, async (tx) => {
    const c = (await tx.select().from(campaigns).where(and(eq(campaigns.id, id), eq(campaigns.tenantId, session.tenantId))).limit(1))[0];
    if (!c) return null;
    const seg = c.segmentId
      ? (await tx.select().from(segments).where(and(eq(segments.id, c.segmentId), eq(segments.tenantId, session.tenantId))).limit(1))[0]
      : null;
    const tpl = c.templateId
      ? (await tx.select().from(templates).where(and(eq(templates.id, c.templateId), eq(templates.tenantId, session.tenantId))).limit(1))[0]
      : null;
    const variantTpl = c.variantTemplateId
      ? (await tx.select().from(templates).where(and(eq(templates.id, c.variantTemplateId), eq(templates.tenantId, session.tenantId))).limit(1))[0]
      : null;
    // Authoritative per-message funnel — aggregate the campaign's communications
    // rows by status (status is monotonic, so "delivered"/"opened" must count
    // anything that progressed past them).
    const statusRows = await tx
      .select({ status: communications.status, n: sql<number>`count(*)::int` })
      .from(communications)
      .where(and(eq(communications.campaignId, id), eq(communications.tenantId, session.tenantId)))
      .groupBy(communications.status);
    // Total clicks (orthogonal to delivery status).
    const [clk] = await tx
      .select({ n: sql<number>`count(*) FILTER (WHERE ${communications.clickedAt} IS NOT NULL)::int` })
      .from(communications)
      .where(and(eq(communications.campaignId, id), eq(communications.tenantId, session.tenantId)));
    // Per-variant funnel (A/B).
    const variantAgg = await tx.execute(sql`
      SELECT variant,
        count(*) FILTER (WHERE status IN ('sent','delivered','read','replied'))::int AS sent,
        count(*) FILTER (WHERE status IN ('read','replied'))::int AS opened,
        count(*) FILTER (WHERE clicked_at IS NOT NULL)::int AS clicked
      FROM communications
      WHERE campaign_id = ${id}::uuid AND tenant_id = ${session.tenantId}::uuid AND direction = 'outbound'
      GROUP BY variant
    `);
    return { c, seg, tpl, variantTpl, statusRows, clicks: Number(clk?.n ?? 0), variantAgg: variantAgg.rows as any[] };
  });
  if (!data) notFound();
  const { c, seg, tpl, variantTpl, statusRows, clicks, variantAgg } = data;
  const Icon = ICONS[c.channel] ?? Send;

  // ── Funnel + rates from the status aggregate ──
  const sc: Record<string, number> = {};
  for (const r of statusRows) sc[r.status] = Number(r.n);
  const g = (s: string) => sc[s] ?? 0;
  const opened = g("read") + g("replied");
  const delivered = g("delivered") + opened; // delivered or beyond
  const bounced = g("bounced");
  const failed = g("failed");
  const sent = g("sent") + delivered + bounced; // anything that left our system
  const skipped = Object.entries(sc)
    .filter(([k]) => k.startsWith("skipped_"))
    .reduce((a, [, v]) => a + v, 0);
  const recipients = c.totalRecipients ?? Object.values(sc).reduce((a, b) => a + b, 0);
  const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : "—");

  // ── A/B variant breakdown ──
  const va: Record<string, { sent: number; opened: number; clicked: number }> = {};
  for (const r of variantAgg) va[(r.variant as string) ?? "_"] = { sent: Number(r.sent ?? 0), opened: Number(r.opened ?? 0), clicked: Number(r.clicked ?? 0) };
  const hasAb = !!c.variantTemplateId;
  const aStat = { label: "Variant A", templateName: tpl?.name ?? null, ...(va["a"] ?? { sent: 0, opened: 0, clicked: 0 }) };
  const bStat = { label: "Variant B", templateName: variantTpl?.name ?? null, ...(va["b"] ?? { sent: 0, opened: 0, clicked: 0 }) };
  const canPickWinner = c.status === "sending" || c.status === "paused"; // sending the winner to the remainder only helps mid-flight

  const inr = (n: unknown) => `₹${Number(n ?? 0).toLocaleString("en-IN")}`;

  return (
    <div className="space-y-6 max-w-5xl">
      <Link href="/dashboard/campaigns" className="text-sm text-muted-foreground hover:underline flex items-center gap-1">
        <ChevronLeft className="size-4" /> Back to broadcasts
      </Link>

      <div className="border rounded-lg bg-card p-6">
        <div className="flex items-start gap-4">
          <div className="size-12 rounded-lg bg-primary/10 grid place-items-center">
            <Icon className="size-6 text-primary" />
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-bold tracking-tight">{c.name}</h1>
            <div className="flex items-center gap-3 mt-1 text-sm">
              <span className="capitalize">{c.channel}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[c.status]}`}>{c.status}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full ${c.approvalStatus === "approved" || c.approvalStatus === "not_required" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                approval: {(c.approvalStatus ?? "pending").replace(/_/g, " ")}
              </span>
              {c.scheduledAt && <span className="text-muted-foreground">scheduled {formatDate(c.scheduledAt)}</span>}
              {c.startedAt && <span className="text-muted-foreground">sent {formatDate(c.startedAt)}</span>}
            </div>
          </div>
          <CampaignActions
            id={c.id}
            status={c.status}
            approvalStatus={c.approvalStatus ?? "pending"}
            isBroadcast={isBroadcastCampaign(c)}
          />
          <RecordProvenance
            entityType="campaign"
            entityId={c.id}
            createdAt={c.createdAt}
            updatedAt={c.updatedAt}
            className="basis-full mt-1"
          />
        </div>
      </div>

      {isBroadcastCampaign(c) && !c.segmentId && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 text-amber-800 px-4 py-3 text-sm flex items-start gap-2">
          <span aria-hidden>⚠</span>
          <div>
            <strong>No audience attached</strong> — this campaign has no recipients, so it can&apos;t send. Create a new
            campaign and, in the Audience step, pick <em>All clients</em>, <em>All leads</em>, or <em>By criteria</em> (you
            should see a green “N recipients will receive this”), then launch.
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        <Stat label="Recipients" value={recipients} />
        <Stat label="Sent" value={sent} />
        <Stat label="Delivered" value={delivered} tone="emerald" sub={`${pct(delivered, sent)} of sent`} />
        <Stat label="Opened" value={opened} tone="blue" sub={`${pct(opened, delivered)} of delivered`} />
        <Stat label="Clicked" value={clicks} tone="blue" sub={`${pct(clicks, delivered)} of delivered`} />
        <Stat label="Bounced" value={bounced} tone={bounced > 0 ? "rose" : "muted"} sub={`${pct(bounced, sent)} of sent`} />
        <Stat label="Failed" value={failed} tone={failed > 0 ? "rose" : "muted"} />
        <Stat label="Blocked / Skipped" value={skipped} tone={skipped > 0 ? "amber" : "muted"} sub="no contact / consent" />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="border rounded-lg bg-card p-5">
          <h2 className="font-semibold mb-3">Template</h2>
          {tpl ? (
            <Link href={`/dashboard/templates/${tpl.id}`} className="block">
              <div className="font-medium hover:underline">{tpl.name}</div>
              <div className="text-xs text-muted-foreground mt-1 font-mono">{tpl.key}</div>
            </Link>
          ) : (
            <p className="text-sm text-muted-foreground">No template attached.</p>
          )}
        </div>
        <div className="border rounded-lg bg-card p-5">
          <h2 className="font-semibold mb-3">Audience</h2>
          {seg ? (
            <div className="block">
              <div className="font-medium">{seg.name}</div>
              <div className="text-xs text-muted-foreground mt-1">{seg.memberCount ?? 0} members at last refresh</div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No segment attached.</p>
          )}
          {c.recurrence && c.recurrence !== "none" && (
            <div className="mt-3 text-xs inline-flex items-center gap-1.5 rounded-full bg-violet-50 text-violet-700 px-2.5 py-1">
              ↻ Repeats {c.recurrence}{c.recurrenceUntil ? ` until ${formatDate(c.recurrenceUntil)}` : ""}
            </div>
          )}
        </div>
      </div>

      {hasAb && (
        <CampaignAbResults
          campaignId={c.id}
          a={aStat}
          b={bStat}
          currentWinner={(c.abWinner as "a" | "b" | null) ?? null}
          canPick={canPickWinner}
        />
      )}

      {/* ROI + Test send */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="border rounded-lg bg-card p-5">
          <h2 className="font-semibold mb-1">Return on investment</h2>
          <p className="text-xs text-muted-foreground mb-3">
            Meetings &amp; conversions are auto-attributed to recipients within 30 days of launch. Use <em>Recompute ROI</em> above to refresh.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="Leads" value={c.leadsGenerated ?? 0} />
            <Stat label="Meetings" value={c.meetingsBooked ?? 0} tone="blue" />
            <Stat label="Conversions" value={c.clientsConverted ?? 0} tone="emerald" />
            <div className="border rounded-lg p-4 bg-card">
              <div className="text-xs text-muted-foreground">Cost</div>
              <div className="text-2xl font-bold mt-1">{inr(c.campaignCost)}</div>
              {Number(c.clientsConverted ?? 0) > 0 && Number(c.campaignCost ?? 0) > 0 && (
                <div className="text-[10px] text-muted-foreground mt-0.5">{inr(Number(c.campaignCost) / Number(c.clientsConverted))} / conversion</div>
              )}
            </div>
          </div>
        </div>

        <CampaignTestSend campaignId={c.id} channel={c.channel} hasVariantB={hasAb} />
      </div>

      <CampaignRecipients campaignId={c.id} />
    </div>
  );
}

function Stat({ label, value, tone, sub }: { label: string; value: number; tone?: "rose" | "emerald" | "blue" | "amber" | "muted"; sub?: string }) {
  const color = { rose: "text-rose-600", emerald: "text-emerald-600", blue: "text-blue-600", amber: "text-amber-600", muted: "text-foreground" }[tone ?? "muted"];
  return (
    <div className="border rounded-lg p-4 bg-card">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${color}`}>{value.toLocaleString("en-IN")}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}
