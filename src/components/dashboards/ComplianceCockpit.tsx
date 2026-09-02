import Link from "next/link";
import { sql } from "drizzle-orm";
import {
  ShieldCheck,
  ShieldCheck as ShieldIcon,
  AlertTriangle,
  ClipboardList,
  FileText,
  FileCheck,
  Activity,
  ArrowRight,
  Clock,
  ExternalLink,
} from "lucide-react";
import { withTenant } from "@/db/client";
import { formatDate, formatRelative } from "@/lib/utils";
import type { SessionUser } from "@/lib/auth/session";
import { resolvePeriodRange, type Period } from "@/lib/dashboard/period";
import { PeriodSelector } from "./PeriodSelector";
import { DashboardEmptyState } from "./DashboardEmptyState";
import { Stat } from "./DashboardShared";

export async function ComplianceCockpit({
  session,
  period,
  customStart,
}: {
  session: SessionUser;
  period?: Period;
  customStart?: string;
}) {
  const now = new Date();
  const range = resolvePeriodRange(period ?? "mtd", now, { customStart });
  const fromISO = range.fromISO;
  const toISO = range.toISO;

  const data = await withTenant(
    session.tenantId,
    async (tx) => {
      const [
        ddqScoreLatest,
        expiries,
        templates,
        auditLogs,
        circulars,
        checklistSummary
      ] = await Promise.all([
        // 1. Latest DDQ score
        await tx.execute(sql`
          SELECT computed_at, overall_score::numeric, breakdown, findings
          FROM ddq_scores
          ORDER BY computed_at DESC
          LIMIT 1
        `),

        // 2. Expiries & Gaps
        await tx.execute(sql`
          SELECT
            COUNT(*) FILTER (WHERE ckyc_expiry_at IS NOT NULL
              AND ckyc_expiry_at BETWEEN current_date AND current_date + interval '30 days')::int AS kyc_30,
            COUNT(*) FILTER (WHERE ckyc_expiry_at IS NOT NULL
              AND ckyc_expiry_at BETWEEN current_date + interval '30 days' AND current_date + interval '90 days')::int AS kyc_90,
            COUNT(*) FILTER (WHERE fatca_expiry_at IS NOT NULL
              AND fatca_expiry_at BETWEEN current_date AND current_date + interval '30 days')::int AS fatca_30,
            COUNT(*) FILTER (WHERE risk_profile_signed_at IS NULL
              OR risk_profile_signed_at < now() - interval '335 days')::int AS risk_profile_stale,
            COUNT(*) FILTER (WHERE nominee_name IS NULL OR nominee_name = '')::int AS nominee_missing,
            COUNT(*) FILTER (WHERE pan_aadhaar_link_status IN ('not_linked', 'pending'))::int AS pan_aadhaar_unlinked,
            (SELECT COUNT(*)::int FROM compliance_documents WHERE expires_on IS NOT NULL AND expires_on <= current_date)::int AS expired_docs
          FROM investors WHERE status = 'active' AND deleted_at IS NULL
        `),

        // 3. Marketing & Template approval pipeline.
        //    Pending-approval counts are the live queue (templates still awaiting
        //    a decision), but we ALSO scope a "submitted this period" count so the
        //    dashboard reflects the chosen window.
        await tx.execute(sql`
          SELECT
            (SELECT COUNT(*)::int FROM templates WHERE status = 'pending_approval' AND category = 'marketing'
                AND created_at >= ${fromISO} AND created_at <= ${toISO}) AS pending_marketing,
            (SELECT COUNT(*)::int FROM templates WHERE status = 'pending_approval' AND category = 'transactional'
                AND created_at >= ${fromISO} AND created_at <= ${toISO}) AS pending_tx,
            (SELECT COUNT(*)::int FROM whatsapp_templates WHERE meta_status = 'PENDING') AS meta_pending,
            (SELECT COUNT(*)::int FROM whatsapp_templates WHERE meta_status = 'REJECTED') AS meta_rejected
        `),

        // 4. Recent Audit Logs — scoped to the selected period.
        await tx.execute(sql`
          SELECT a.id, a.action, a.actor_type, a.at, u.name AS actor_name
          FROM audit_log a
          LEFT JOIN users u ON u.id = a.actor_user_id
          WHERE a.at >= ${fromISO} AND a.at <= ${toISO}
          ORDER BY a.at DESC
          LIMIT 8
        `),

        // 5. Active Circulars (AMFI)
        await tx.execute(sql`
          SELECT id, title, circular_no, issued_at, source_url
          FROM amfi_circulars
          ORDER BY issued_at DESC
          LIMIT 4
        `),

        // 6. DDQ Checklist status summary
        await tx.execute(sql`
          SELECT status, COUNT(*)::int AS count
          FROM ddq_checklist_status
          GROUP BY status
        `)
      ]);

      return {
        ddq: ddqScoreLatest.rows[0] as any,
        expiries: expiries.rows[0] as any,
        templates: templates.rows[0] as any,
        auditLogs: auditLogs.rows as any[],
        circulars: circulars.rows as any[],
        checklist: checklistSummary.rows as any[]
      };
    },
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );

  const ddqScore = data.ddq?.overall_score != null ? Number(data.ddq.overall_score) : null;
  const ddqBreakdown: Record<string, unknown> =
    data.ddq?.breakdown && typeof data.ddq.breakdown === "object" ? data.ddq.breakdown : {};

  /** Read a breakdown sub-score; `null` when the key is absent → "not assessed". */
  const bd = (key: string): number | null => {
    const v = ddqBreakdown[key];
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const exp = data.expiries ?? {};
  const tpl = data.templates ?? {};

  const totalExpiriesCount =
    Number(exp.kyc_30 ?? 0) +
    Number(exp.fatca_30 ?? 0) +
    Number(exp.risk_profile_stale ?? 0) +
    Number(exp.nominee_missing ?? 0) +
    Number(exp.pan_aadhaar_unlinked ?? 0) +
    Number(exp.expired_docs ?? 0);

  const checklistCounts = Object.fromEntries(
    data.checklist.map((r) => [r.status, Number(r.count)])
  );
  const checklistTotal = data.checklist.reduce((sum, r) => sum + r.count, 0);
  const checklistInPlace = checklistCounts["in_place"] ?? 0;

  const today = now.toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  });

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Branded Header */}
      <div className="card-elevated overflow-hidden border-amber-200/50">
        <div className="brand-mesh px-6 py-5 text-white bg-gradient-to-r from-amber-900 to-amber-950">
          <div className="flex items-end justify-between flex-wrap gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-amber-300 font-bold">
                Compliance Engine
              </div>
              <h1 className="text-2xl font-bold tracking-tight mt-1">
                Compliance Cockpit
              </h1>
              <p className="text-amber-100/80 text-sm mt-1">
                {today} · Activity window: <span className="font-semibold">{range.label}</span>.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="chip bg-amber-500/20 text-amber-300 backdrop-blur-sm border border-amber-500/30 text-xs">
                <span className="pulse-dot bg-amber-400" /> Active Watch
              </span>
              <PeriodSelector current={period ?? "mtd"} variant="light" />
            </div>
          </div>
        </div>
      </div>

      {/* Headline Scores Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat
          href="/dashboard/compliance"
          label="DDQ Readiness Score"
          value={ddqScore != null ? `${ddqScore.toFixed(0)}%` : "—"}
          tone={ddqScore != null && ddqScore < 70 ? "rose" : ddqScore != null && ddqScore < 85 ? "amber" : "emerald"}
          icon={ShieldIcon}
          sub={data.ddq?.computed_at ? `Computed ${formatRelative(data.ddq.computed_at)}` : "No run yet"}
        />
        <Stat
          href="/dashboard/compliance"
          label="Checklist progress"
          value={checklistTotal > 0 ? `${Math.round((checklistInPlace / checklistTotal) * 100)}%` : "—"}
          sub={`${checklistInPlace} of ${checklistTotal} tasks in place`}
          tone={checklistInPlace === checklistTotal ? "emerald" : "amber"}
          icon={ClipboardList}
        />
        <Stat
          href="/dashboard/templates"
          label="Pending approvals"
          value={String(Number(tpl.pending_marketing ?? 0) + Number(tpl.pending_tx ?? 0))}
          sub={`${tpl.pending_marketing ?? 0} mktg · ${tpl.pending_tx ?? 0} txn · ${range.label}`}
          tone={Number(tpl.pending_marketing ?? 0) + Number(tpl.pending_tx ?? 0) > 0 ? "amber" : "muted"}
          icon={FileCheck}
        />
        <Stat
          href="/dashboard/investors?gaps=all"
          label="Critical Expiry Flags"
          value={String(totalExpiriesCount)}
          sub={`${exp.expired_docs ?? 0} expired files in vault`}
          tone={totalExpiriesCount > 0 ? "rose" : "muted"}
          icon={AlertTriangle}
        />
      </div>

      {/* Main Split Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column (2/3 width on desktop) */}
        <div className="lg:col-span-2 space-y-6">
          {/* DDQ breakdown stats */}
          <div className="card-surface glass-card p-5">
            <h2 className="font-semibold text-sm tracking-tight text-foreground/90 mb-4 flex items-center gap-2">
              <ShieldCheck className="size-4 text-amber-600" /> DDQ Breakdown Checklist
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <BreakdownProgress label="NISM Validity" score={bd("nismValidity")} />
              <BreakdownProgress label="ARN Renewal Status" score={bd("arnRenewalStatus")} />
              <BreakdownProgress label="KYD Completeness" score={bd("kydCompleteness")} />
              <BreakdownProgress label="Empanelment Checklist" score={bd("empanelmentCompleteness")} />
              <BreakdownProgress label="SOP Employee Signoffs" score={bd("sopSignoffCoverage")} />
              <BreakdownProgress label="Audit Trail Integrity" score={bd("auditTrailIntegrity")} />
            </div>
            <div className="mt-4 pt-3 border-t text-right">
              <Link href="/dashboard/compliance" className="text-xs text-amber-700 hover:underline font-semibold inline-flex items-center gap-1">
                View AMFI self-audit questionnaire <ArrowRight className="size-3" />
              </Link>
            </div>
          </div>

          {/* Recent Audit log table */}
          <div className="card-surface glass-card p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-sm tracking-tight text-foreground/90 flex items-center gap-2">
                <Activity className="size-4 text-amber-600" /> Audit Log Trail
                <span className="text-[10px] font-medium text-muted-foreground normal-case">· {range.label}</span>
              </h2>
              <Link href="/dashboard/audit-log" className="text-xs text-amber-700 hover:underline font-semibold">
                Open full audit register →
              </Link>
            </div>
            {data.auditLogs.length === 0 ? (
              <DashboardEmptyState
                icon={Activity}
                compact
                title="No audit actions in this period"
                hint="System and user actions recorded in this window will appear here."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left table-modern">
                  <thead>
                    <tr>
                      <th className="py-2 px-2">Timestamp</th>
                      <th className="py-2 px-2">Actor</th>
                      <th className="py-2 px-2">Action type</th>
                      <th className="py-2 px-2">Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.auditLogs.map((log: any) => (
                      <tr key={log.id}>
                        <td className="py-2 px-2 text-muted-foreground">{formatRelative(log.at)}</td>
                        <td className="py-2 px-2 font-medium">{log.actor_name ?? "System"}</td>
                        <td className="py-2 px-2 font-mono text-amber-800 dark:text-amber-400">{log.action}</td>
                        <td className="py-2 px-2 capitalize text-muted-foreground">{log.actor_type}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Right column (1/3 width on desktop) */}
        <div className="space-y-6">
          {/* Expiries Panel */}
          <div className="card-surface glass-card p-5">
            <h2 className="font-semibold text-sm tracking-tight text-foreground/90 mb-3 flex items-center gap-2">
              <Clock className="size-4 text-amber-600" /> Compliance Expiry Funnel
            </h2>
            <div className="space-y-2.5 text-xs">
              <ExpiryRow label="KYC Expiring (30d)" count={exp.kyc_30} href="/dashboard/investors?kyc_expiring=30" tone="rose" />
              <ExpiryRow label="KYC Expiring (90d)" count={exp.kyc_90} href="/dashboard/investors?kyc_expiring=90" tone="amber" />
              <ExpiryRow label="FATCA Stale (30d)" count={exp.fatca_30} href="/dashboard/investors?fatca_expiring=30" tone="rose" />
              <ExpiryRow label="Risk Profile Stale" count={exp.risk_profile_stale} href="/dashboard/risk-profiles" tone="amber" />
              <ExpiryRow label="Nominee Missing" count={exp.nominee_missing} href="/dashboard/investors?nominee=missing" tone="rose" />
              <ExpiryRow label="PAN-Aadhaar Unlinked" count={exp.pan_aadhaar_unlinked} href="/dashboard/investors?pan_aadhaar=not_linked" tone="rose" />
            </div>
          </div>

          {/* Meta template approvals */}
          <div className="card-surface glass-card p-5">
            <h2 className="font-semibold text-sm tracking-tight text-foreground/90 mb-3 flex items-center gap-2">
              <FileText className="size-4 text-amber-600" /> Meta WhatsApp Templates
            </h2>
            {Number(tpl.meta_pending ?? 0) === 0 && Number(tpl.meta_rejected ?? 0) === 0 ? (
              <DashboardEmptyState
                icon={FileCheck}
                compact
                title="All templates clear"
                hint="No WhatsApp templates pending or rejected at Meta."
              />
            ) : (
              <div className="grid grid-cols-2 gap-3 text-center">
                <div className="p-3 bg-secondary/30 rounded border border-border/40">
                  <div className="text-[10px] uppercase font-bold text-muted-foreground">Pending Meta</div>
                  <div className="text-xl font-bold mt-1 text-amber-600">{tpl.meta_pending ?? 0}</div>
                </div>
                <div className="p-3 bg-secondary/30 rounded border border-border/40">
                  <div className="text-[10px] uppercase font-bold text-muted-foreground">Rejected Meta</div>
                  <div className="text-xl font-bold mt-1 text-rose-600">{tpl.meta_rejected ?? 0}</div>
                </div>
              </div>
            )}
            <div className="mt-3 text-right">
              <Link href="/dashboard/templates" className="text-xs text-amber-700 hover:underline font-semibold">
                Manage WhatsApp templates →
              </Link>
            </div>
          </div>

          {/* Circulars */}
          <div className="card-surface glass-card p-5">
            <h2 className="font-semibold text-sm tracking-tight text-foreground/90 mb-3 flex items-center gap-2">
              <ExternalLink className="size-4 text-amber-600" /> Recent AMFI Circulars
            </h2>
            {data.circulars.length === 0 ? (
              <DashboardEmptyState
                icon={ExternalLink}
                compact
                title="No circulars on file"
                hint="AMFI / SEBI circulars synced to your tenant will list here."
              />
            ) : (
              <ul className="space-y-3">
                {data.circulars.map((c: any) => (
                  <li key={c.id} className="text-xs flex flex-col space-y-1">
                    <a
                      href={c.source_url ?? "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium hover:underline text-amber-800 dark:text-amber-400 flex items-start gap-1"
                    >
                      <span className="flex-1 leading-snug">{c.title}</span>
                      <ExternalLink className="size-3 flex-shrink-0 mt-0.5" />
                    </a>
                    <div className="text-[10px] text-muted-foreground flex justify-between">
                      <span>No: {c.circular_no ?? "AMFI-2026"}</span>
                      <span>{formatDate(c.issued_at)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ExpiryRow({
  label,
  count,
  href,
  tone
}: {
  label: string;
  count: number;
  href: string;
  tone: "rose" | "amber";
}) {
  if (!count) return null;
  const badgeCls =
    tone === "rose"
      ? "bg-rose-50 text-rose-700 border-rose-100"
      : "bg-amber-50 text-amber-700 border-amber-100";
  return (
    <Link href={href} className="flex justify-between items-center py-1.5 border-b last:border-0 border-border/40 hover:bg-secondary/20 rounded px-1 transition-colors">
      <span className="text-muted-foreground font-medium">{label}</span>
      <span className={`chip border ${badgeCls} text-[10px] font-bold px-1.5 py-0.5`}>
        {count}
      </span>
    </Link>
  );
}

function BreakdownProgress({ label, score }: { label: string; score: number | null }) {
  // A missing breakdown key renders as "not assessed" rather than a fake 0%.
  if (score == null) {
    return (
      <div>
        <div className="flex justify-between text-xs mb-1">
          <span className="font-medium text-muted-foreground">{label}</span>
          <span className="font-semibold text-muted-foreground/70 italic">Not assessed</span>
        </div>
        <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
          <div className="h-full rounded-full bg-border" style={{ width: "0%" }} />
        </div>
      </div>
    );
  }
  const color = score >= 80 ? "bg-emerald-500" : score >= 60 ? "bg-amber-500" : "bg-rose-500";
  const textColor = score >= 80 ? "text-emerald-700" : score >= 60 ? "text-amber-700" : "text-rose-700";
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="font-medium text-muted-foreground">{label}</span>
        <span className={`font-bold ${textColor}`}>{score}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${score}%` }} />
      </div>
    </div>
  );
}
