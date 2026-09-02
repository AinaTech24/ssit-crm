import Link from "next/link";
import { sql } from "drizzle-orm";
import { Heart, ShieldQuestion, ListChecks, MessageCircle } from "lucide-react";
import { withTenant } from "@/db/client";
import type { SessionUser } from "@/lib/auth/session";

/**
 * Marketing service-excellence additions — appended below the existing
 * MarketingDashboard so nothing is removed:
 *   1. Service-vs-marketing comm split (% utility/transactional vs marketing)
 *   2. Consent base health (WA opt-in %, email deliverability, unsubscribes)
 *   3. Template approval pipeline (Meta WA + internal approvals)
 *   4. Source conversion (which sources actually convert, not just generate leads)
 */
export async function MarketingInsightsSection({ session }: { session: SessionUser }) {
  const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();

  const data = await withTenant(
    session.tenantId,
    async (tx) => {
      const [commsSplit, consentHealth, templatePipeline, sourceConversion] = await Promise.all([
        // 1. Service vs marketing comm split — last 30 days
        await tx.execute(sql`
          SELECT
            COUNT(*) FILTER (
              WHERE tv.id IS NOT NULL
                AND t.category IN ('transactional', 'utility')
                AND c.sent_at >= now() - interval '30 days'
            )::int AS service_count,
            COUNT(*) FILTER (
              WHERE tv.id IS NOT NULL
                AND t.category = 'marketing'
                AND c.sent_at >= now() - interval '30 days'
            )::int AS marketing_count,
            COUNT(*) FILTER (
              WHERE c.status IN ('sent', 'delivered', 'read', 'replied')
                AND c.sent_at >= now() - interval '30 days'
            )::int AS total_sent
          FROM communications c
          LEFT JOIN template_versions tv ON tv.id = c.template_version_id
          LEFT JOIN templates t ON t.id = tv.template_id
        `),

        // 2. Consent health — opt-in % per channel, recent unsubs, bounce rate
        await tx.execute(sql`
          SELECT
            (SELECT COUNT(*)::int FROM investors WHERE status = 'active' AND deleted_at IS NULL) AS total_active,
            (SELECT COUNT(DISTINCT investor_id)::int FROM consents
              WHERE channel = 'whatsapp' AND status = 'granted'
                AND scope IN ('marketing', 'all')) AS wa_opted_in,
            (SELECT COUNT(DISTINCT investor_id)::int FROM consents
              WHERE channel = 'email' AND status = 'granted'
                AND scope IN ('marketing', 'all')) AS email_opted_in,
            (SELECT COUNT(*)::int FROM communications
              WHERE status = 'unsubscribed'
                AND created_at >= ${startOfMonth}) AS unsubs_mtd,
            (SELECT COUNT(*)::int FROM communications
              WHERE status = 'bounced'
                AND created_at >= ${startOfMonth}) AS bounces_mtd,
            (SELECT COUNT(*)::int FROM communications
              WHERE channel = 'email'
                AND status IN ('sent', 'delivered', 'read', 'replied', 'bounced', 'failed')
                AND created_at >= ${startOfMonth}) AS email_attempted_mtd,
            (SELECT COUNT(*)::int FROM communications
              WHERE channel = 'email'
                AND status IN ('delivered', 'read', 'replied')
                AND created_at >= ${startOfMonth}) AS email_delivered_mtd
        `),

        // 3. Template approval pipeline
        await tx.execute(sql`
          SELECT
            (SELECT COUNT(*)::int FROM templates WHERE status = 'pending_approval') AS pending_internal,
            (SELECT COUNT(*)::int FROM whatsapp_templates WHERE meta_status = 'PENDING') AS meta_pending,
            (SELECT COUNT(*)::int FROM whatsapp_templates WHERE meta_status = 'REJECTED') AS meta_rejected,
            (SELECT COUNT(*)::int FROM whatsapp_templates WHERE meta_status = 'APPROVED') AS meta_approved,
            (SELECT EXTRACT(DAY FROM (now() - MIN(created_at)))::int FROM whatsapp_templates
              WHERE meta_status = 'PENDING') AS oldest_pending_days
        `),

        // 4. Source-wise conversion MTD
        await tx.execute(sql`
          SELECT
            source,
            COUNT(*)::int AS leads,
            COUNT(*) FILTER (WHERE converted_investor_id IS NOT NULL)::int AS converted
          FROM leads
          WHERE created_at >= ${startOfMonth}
          GROUP BY source
          HAVING COUNT(*) > 0
          ORDER BY converted DESC, leads DESC
          LIMIT 6
        `),
      ]);

      const split = commsSplit.rows[0] as any;
      const ch = consentHealth.rows[0] as any;
      const tp = templatePipeline.rows[0] as any;

      const serviceCount = Number(split.service_count);
      const marketingCount = Number(split.marketing_count);
      const totalCommSplit = serviceCount + marketingCount;

      const totalActive = Number(ch.total_active);
      const waPct = totalActive > 0 ? (Number(ch.wa_opted_in) / totalActive) * 100 : 0;
      const emailPct = totalActive > 0 ? (Number(ch.email_opted_in) / totalActive) * 100 : 0;
      const emailAttempted = Number(ch.email_attempted_mtd);
      const deliverability =
        emailAttempted > 0 ? (Number(ch.email_delivered_mtd) / emailAttempted) * 100 : null;

      return {
        commsSplit: {
          service: serviceCount,
          marketing: marketingCount,
          servicePct: totalCommSplit > 0 ? (serviceCount / totalCommSplit) * 100 : 0,
          totalSent: Number(split.total_sent),
        },
        consentHealth: {
          waPct,
          emailPct,
          waCount: Number(ch.wa_opted_in),
          emailCount: Number(ch.email_opted_in),
          totalActive,
          unsubsMtd: Number(ch.unsubs_mtd),
          bouncesMtd: Number(ch.bounces_mtd),
          deliverability,
        },
        templatePipeline: {
          pendingInternal: Number(tp.pending_internal),
          metaPending: Number(tp.meta_pending),
          metaRejected: Number(tp.meta_rejected),
          metaApproved: Number(tp.meta_approved),
          oldestPendingDays: tp.oldest_pending_days != null ? Number(tp.oldest_pending_days) : null,
        },
        sourceConversion: (sourceConversion.rows as any[]).map((r) => ({
          source: String(r.source),
          leads: Number(r.leads),
          converted: Number(r.converted),
          convPct: Number(r.leads) > 0 ? (Number(r.converted) / Number(r.leads)) * 100 : 0,
        })),
      };
    },
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );

  return (
    <div className="space-y-6">
      {/* Service vs marketing comm split */}
      <div className="card-surface glass-card p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold flex items-center gap-2 text-sm tracking-tight text-foreground/90">
            <div className="size-7 rounded-lg bg-brand-cyan-light grid place-items-center">
              <MessageCircle className="size-3.5 text-brand-cyan-deep" />
            </div>
            Service vs marketing comm mix (30d)
          </h2>
          <span className="text-xs text-muted-foreground">
            Healthy MFDs run ~70% service-heavy
          </span>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium">Service / transactional</span>
            <span className="tabular-nums font-semibold text-emerald-700">
              {data.commsSplit.service.toLocaleString("en-IN")} (
              {data.commsSplit.servicePct.toFixed(0)}%)
            </span>
          </div>
          <div className="h-2 rounded-full bg-secondary overflow-hidden flex">
            <div
              className="bg-emerald-500"
              style={{ width: `${data.commsSplit.servicePct}%` }}
            />
            <div
              className="bg-violet-500"
              style={{ width: `${100 - data.commsSplit.servicePct}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium">Marketing</span>
            <span className="tabular-nums font-semibold text-violet-700">
              {data.commsSplit.marketing.toLocaleString("en-IN")} (
              {(100 - data.commsSplit.servicePct).toFixed(0)}%)
            </span>
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground mt-3">
          Total sent (30d): {data.commsSplit.totalSent.toLocaleString("en-IN")}.
          Build trust by leading with service utility before marketing pushes.
        </p>
      </div>

      {/* Consent health + Template pipeline */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card-surface glass-card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold flex items-center gap-2 text-sm tracking-tight text-foreground/90">
              <div className="size-7 rounded-lg bg-emerald-50 grid place-items-center">
                <Heart className="size-3.5 text-emerald-600" />
              </div>
              Consent base health
            </h2>
            <span className="text-xs text-muted-foreground">
              {data.consentHealth.totalActive} active
            </span>
          </div>
          <div className="space-y-3">
            <ConsentRow
              label="WhatsApp opt-in"
              count={data.consentHealth.waCount}
              total={data.consentHealth.totalActive}
              pct={data.consentHealth.waPct}
            />
            <ConsentRow
              label="Email opt-in"
              count={data.consentHealth.emailCount}
              total={data.consentHealth.totalActive}
              pct={data.consentHealth.emailPct}
            />
            <div className="grid grid-cols-3 gap-2 mt-3">
              <MiniStat
                label="Unsubs (MTD)"
                value={data.consentHealth.unsubsMtd}
                tone={data.consentHealth.unsubsMtd > 0 ? "amber" : "muted"}
              />
              <MiniStat
                label="Bounces (MTD)"
                value={data.consentHealth.bouncesMtd}
                tone={data.consentHealth.bouncesMtd > 5 ? "rose" : "muted"}
              />
              <MiniStat
                label="Email delivery"
                value={
                  data.consentHealth.deliverability != null
                    ? `${data.consentHealth.deliverability.toFixed(0)}%`
                    : "—"
                }
                tone={
                  data.consentHealth.deliverability != null &&
                  data.consentHealth.deliverability < 90
                    ? "rose"
                    : "emerald"
                }
              />
            </div>
          </div>
        </div>

        <div className="card-surface glass-card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold flex items-center gap-2 text-sm tracking-tight text-foreground/90">
              <div className="size-7 rounded-lg bg-amber-50 grid place-items-center">
                <ListChecks className="size-3.5 text-amber-700" />
              </div>
              Template approval pipeline
            </h2>
            <Link
              href="/dashboard/templates"
              className="text-xs text-amber-700 hover:underline font-semibold"
            >
              Templates →
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <PipelineTile
              label="Internal approval"
              value={data.templatePipeline.pendingInternal}
              tone={data.templatePipeline.pendingInternal > 0 ? "amber" : "muted"}
            />
            <PipelineTile
              label="Meta — pending"
              value={data.templatePipeline.metaPending}
              sub={
                data.templatePipeline.oldestPendingDays != null
                  ? `oldest ${data.templatePipeline.oldestPendingDays}d`
                  : undefined
              }
              tone={
                data.templatePipeline.oldestPendingDays != null &&
                data.templatePipeline.oldestPendingDays > 3
                  ? "rose"
                  : data.templatePipeline.metaPending > 0
                  ? "amber"
                  : "muted"
              }
            />
            <PipelineTile
              label="Meta — approved"
              value={data.templatePipeline.metaApproved}
              tone="emerald"
            />
            <PipelineTile
              label="Meta — rejected"
              value={data.templatePipeline.metaRejected}
              tone={data.templatePipeline.metaRejected > 0 ? "rose" : "muted"}
            />
          </div>
          <p className="text-[10px] text-muted-foreground mt-3 leading-relaxed">
            WhatsApp marketing depends on Meta-approved templates. Rejections
            often need just a phrasing tweak — chase them early.
          </p>
        </div>
      </div>

      {/* Source conversion */}
      <div className="card-surface glass-card p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold flex items-center gap-2 text-sm tracking-tight text-foreground/90">
            <div className="size-7 rounded-lg bg-violet-50 grid place-items-center">
              <ShieldQuestion className="size-3.5 text-violet-700" />
            </div>
            Source conversion (MTD)
          </h2>
          <span className="text-xs text-muted-foreground">
            Which channels actually deliver clients
          </span>
        </div>
        {data.sourceConversion.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            No leads attributed by source yet.
          </p>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-[10px] text-muted-foreground uppercase tracking-wider">
              <tr>
                <th className="text-left pb-2">Source</th>
                <th className="text-right pb-2">Leads</th>
                <th className="text-right pb-2">Converted</th>
                <th className="text-right pb-2">Conv %</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.sourceConversion.map((s) => (
                <tr key={s.source}>
                  <td className="py-2 font-medium capitalize">
                    {s.source.replace(/_/g, " ")}
                  </td>
                  <td className="py-2 text-right tabular-nums">{s.leads}</td>
                  <td className="py-2 text-right tabular-nums">{s.converted}</td>
                  <td
                    className={`py-2 text-right tabular-nums font-bold ${
                      s.convPct >= 20
                        ? "text-emerald-700"
                        : s.convPct >= 10
                        ? "text-amber-700"
                        : "text-rose-700"
                    }`}
                  >
                    {s.convPct.toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/* ----------------------- presentational helpers ----------------------- */

function ConsentRow({
  label,
  count,
  total,
  pct,
}: {
  label: string;
  count: number;
  total: number;
  pct: number;
}) {
  const tone = pct >= 75 ? "emerald" : pct >= 50 ? "amber" : "rose";
  const bg =
    tone === "emerald" ? "bg-emerald-500" : tone === "amber" ? "bg-amber-500" : "bg-rose-500";
  const text =
    tone === "emerald" ? "text-emerald-700" : tone === "amber" ? "text-amber-700" : "text-rose-700";
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums">
          <span className={`font-bold ${text}`}>{pct.toFixed(0)}%</span>
          <span className="text-muted-foreground"> · {count.toLocaleString("en-IN")} / {total.toLocaleString("en-IN")}</span>
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
        <div className={`h-full rounded-full ${bg}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
    </div>
  );
}

function MiniStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone: "rose" | "amber" | "emerald" | "muted";
}) {
  const cls =
    tone === "rose"
      ? "text-rose-700 border-rose-100 bg-rose-50/40"
      : tone === "amber"
      ? "text-amber-700 border-amber-100 bg-amber-50/40"
      : tone === "emerald"
      ? "text-emerald-700 border-emerald-100 bg-emerald-50/40"
      : "text-foreground border-border/40 bg-secondary/30";
  return (
    <div className={`p-2 rounded-lg border ${cls}`}>
      <div className="text-[9px] uppercase tracking-wider font-semibold opacity-80">
        {label}
      </div>
      <div className="text-base font-bold mt-0.5 tabular-nums">{value}</div>
    </div>
  );
}

function PipelineTile({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: number;
  sub?: string;
  tone: "rose" | "amber" | "emerald" | "muted";
}) {
  const cls =
    tone === "rose"
      ? "text-rose-700 border-rose-100 bg-rose-50/40"
      : tone === "amber"
      ? "text-amber-700 border-amber-100 bg-amber-50/40"
      : tone === "emerald"
      ? "text-emerald-700 border-emerald-100 bg-emerald-50/40"
      : "text-foreground border-border/40 bg-secondary/30";
  return (
    <div className={`p-3 rounded-lg border ${cls}`}>
      <div className="text-[10px] uppercase tracking-wider font-semibold opacity-80">
        {label}
      </div>
      <div className="text-xl font-bold mt-1 tabular-nums">{value}</div>
      {sub && <div className="text-[10px] opacity-80 mt-0.5">{sub}</div>}
    </div>
  );
}
