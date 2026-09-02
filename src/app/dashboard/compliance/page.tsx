import Link from "next/link";
import { ShieldCheck, AlertTriangle, FileText, FileCheck, ClipboardCheck, ArrowRight } from "lucide-react";
import { withTenant } from "@/db/client";
import { templates, templateVersions, ddqScores, auditLog, users, tenants } from "@/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { requireSession } from "@/lib/auth/session";
import { formatRelative, formatDate } from "@/lib/utils";
import { calculateDdqScore } from "@/lib/compliance/ddq-calculator";
import { RecalculateButton } from "@/components/compliance/RecalculateButton";
import { HelpTip } from "@/components/common/HelpTip";

export const dynamic = "force-dynamic";

function getDaysRemaining(dateStr: string | Date | null | undefined): number | null {
  if (!dateStr) return null;
  const target = typeof dateStr === "string" ? new Date(dateStr) : dateStr;
  const diffTime = target.getTime() - Date.now();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
}

export default async function CompliancePage() {
  const session = await requireSession();

  // Compliance posture (staff cert expiries, audit trail, DDQ) is management
  // information — gate to the same roles as the Command Center.
  if (!session.roles.some((r: string) => ["owner", "compliance", "branch_head"].includes(r))) {
    return (
      <div className="max-w-2xl card-surface p-8 text-center text-sm text-muted-foreground">
        Compliance &amp; DDQ readiness is available to owners and the compliance team.
      </div>
    );
  }

  // Fetch real templates pending approval
  const pendingTemplates = await withTenant(session.tenantId, async (tx) => {
    return tx
      .select({
        id: templates.id,
        name: templates.name,
        key: templates.key,
        versionNumber: templateVersions.versionNumber,
      })
      .from(templates)
      .innerJoin(templateVersions, eq(templateVersions.id, templates.currentVersionId))
      .where(and(eq(templates.tenantId, session.tenantId), eq(templateVersions.approvalStatus, "submitted")));
  });

  // Fetch latest DDQ readiness score
  let scoreData = await withTenant(session.tenantId, async (tx) => {
    const rows = await tx
      .select()
      .from(ddqScores)
      .where(eq(ddqScores.tenantId, session.tenantId))
      .orderBy(desc(ddqScores.computedAt))
      .limit(1);
    return rows[0] || null;
  });

  if (!scoreData) {
    // No saved score yet — compute a live, read-only snapshot for display.
    // A page render must never write; persisting is the recompute action's job
    // (POST /api/compliance/recompute via the Recalculate button).
    const live = await withTenant(session.tenantId, async (tx) => calculateDdqScore(tx, session.tenantId));
    scoreData = {
      overallScore: String(live.overallScore),
      breakdown: live.breakdown,
      computedAt: null,
    } as any;
  }

  const overallScore = scoreData ? Math.round(Number(scoreData.overallScore)) : 50;
  const breakdown = scoreData?.breakdown as {
    nismValidity?: number;
    arnRenewalStatus?: number;
    kydCompleteness?: number;
    complaintRegisterCurrency?: number;
    empanelmentCompleteness?: number;
    sopSignoffCoverage?: number;
    auditTrailIntegrity?: number;
    consentLedger?: number;
  } | null;

  const nismValidity = breakdown?.nismValidity ?? 100;
  const arnRenewalStatus = breakdown?.arnRenewalStatus ?? 100;
  const kydCompleteness = breakdown?.kydCompleteness ?? 100;
  const complaintRegisterCurrency = breakdown?.complaintRegisterCurrency ?? 100;
  const empanelmentCompleteness = breakdown?.empanelmentCompleteness ?? 100;
  const sopSignoffCoverage = breakdown?.sopSignoffCoverage ?? 100;
  const auditTrailIntegrity = breakdown?.auditTrailIntegrity ?? 100;
  const consentLedger = breakdown?.consentLedger ?? 100;

  // Fetch Expiry watchlist data
  const expiriesData = await withTenant(session.tenantId, async (tx) => {
    // A. Tenant ARN
    const tenantRow = (await tx.select({ arnExpiryAt: tenants.arnExpiryAt, displayName: tenants.displayName }).from(tenants).where(eq(tenants.id, session.tenantId)).limit(1))[0];

    // B. User NISM and EUIN
    const activeUsers = await tx
      .select({
        name: users.name,
        nismExpiryAt: users.nismExpiryAt,
        euinExpiryAt: users.euinExpiryAt,
      })
      .from(users)
      .where(and(eq(users.tenantId, session.tenantId), eq(users.status, "active" as any)));

    // C. CKYC expiry from investors
    const expiringInvestors = await tx.execute(sql`
      SELECT name, ckyc_expiry_at 
      FROM investors 
      WHERE tenant_id = ${session.tenantId}::uuid
        AND status = 'active'
        AND ckyc_expiry_at IS NOT NULL
      ORDER BY ckyc_expiry_at ASC
      LIMIT 3
    `);

    // NOTE: AMC empanelments have no expiry date — the relationship runs until
    // `terminated_at`, there is no renewal deadline (and no `expires_at`
    // column). So there is nothing real to surface on an *expiry* watchlist for
    // them; the watchlist is built only from columns that actually carry a
    // regulatory expiry (ARN, NISM, EUIN, CKYC).

    return {
      tenant: tenantRow,
      users: activeUsers,
      investors: expiringInvestors.rows as any[],
    };
  });

  const watchlist: { type: string; who: string; when: string; urgent: boolean; days: number }[] = [];

  // A. Tenant ARN
  if (expiriesData.tenant?.arnExpiryAt) {
    const days = getDaysRemaining(expiriesData.tenant.arnExpiryAt);
    if (days !== null) {
      watchlist.push({
        type: "ARN (Firm)",
        who: expiriesData.tenant.displayName || "Firm Profile",
        when: days < 0 ? "Expired" : `${days} days`,
        urgent: days < 30,
        days: days,
      });
    }
  }

  // B. User NISM & EUIN
  for (const u of expiriesData.users) {
    if (u.nismExpiryAt) {
      const days = getDaysRemaining(u.nismExpiryAt);
      if (days !== null) {
        watchlist.push({
          type: "NISM Certificate",
          who: `${u.name} (RM)`,
          when: days < 0 ? "Expired" : `${days} days`,
          urgent: days < 30,
          days: days,
        });
      }
    }
    if (u.euinExpiryAt) {
      const days = getDaysRemaining(u.euinExpiryAt);
      if (days !== null) {
        watchlist.push({
          type: "EUIN Validity",
          who: `${u.name} (RM)`,
          when: days < 0 ? "Expired" : `${days} days`,
          urgent: days < 30,
          days: days,
        });
      }
    }
  }

  // C. Investors CKYC
  for (const inv of expiriesData.investors) {
    if (inv.ckyc_expiry_at) {
      const days = getDaysRemaining(inv.ckyc_expiry_at);
      if (days !== null) {
        watchlist.push({
          type: "CKYC Certificate",
          who: inv.name,
          when: days < 0 ? "Expired" : `${days} days`,
          urgent: days < 30,
          days: days,
        });
      }
    }
  }

  // Sort watchlist by days remaining (real data only — no padding).
  watchlist.sort((a, b) => a.days - b.days);

  // Fetch recent audit logs
  const recentLogs = await withTenant(session.tenantId, async (tx) => {
    return tx
      .select({
        id: auditLog.id,
        action: auditLog.action,
        actorType: auditLog.actorType,
        at: auditLog.at,
        actorName: users.name,
      })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.actorUserId))
      .orderBy(desc(auditLog.at))
      .limit(6);
  });

  const auditTrailItems = recentLogs.map((log) => {
    return {
      id: log.id,
      atStr: formatDate(log.at),
      actorType: log.actorType,
      actorName: log.actorName || "System",
      action: log.action,
    };
  });

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-bold tracking-tight">Compliance & DDQ readiness</h1>
        <HelpTip title="Compliance / DDQ">
          Your firm&apos;s audit-readiness score. It checks the documents and records SEBI/AMFI
          expect in a due-diligence review (DDQ = Due Diligence Questionnaire) and shows what&apos;s
          missing, so you&apos;re always inspection-ready.
        </HelpTip>
      </div>

      {/* AMFI DDQ audit checklist */}
      <Link
        href="/dashboard/compliance/audit-checklist"
        className="group flex items-center justify-between gap-3 rounded-lg border border-brand-cyan/30 bg-brand-cyan-light/40 px-5 py-4 hover:bg-brand-cyan-light/70 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-lg bg-white/80 grid place-items-center">
            <ClipboardCheck className="size-5 text-brand-cyan-deep" />
          </div>
          <div>
            <div className="font-semibold text-sm">AMFI DDQ audit checklist</div>
            <div className="text-xs text-muted-foreground">
              All 40 due-diligence items across 6 sections — mapped to where the evidence lives,
              with live readiness tracking.
            </div>
          </div>
        </div>
        <span className="inline-flex items-center gap-1 text-sm font-semibold text-brand-cyan-deep whitespace-nowrap">
          Open checklist <ArrowRight className="size-4 group-hover:translate-x-0.5 transition-transform" />
        </span>
      </Link>

      {/* DDQ compliance registers — the records the questionnaire demands
          (self-certification, incidents, unsuitability acknowledgements). */}
      <Link
        href="/dashboard/compliance/registers"
        className="group flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-5 py-4 hover:bg-secondary/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-lg bg-secondary grid place-items-center">
            <ClipboardCheck className="size-5 text-brand-cyan-deep" />
          </div>
          <div>
            <div className="font-semibold text-sm">DDQ compliance registers</div>
            <div className="text-xs text-muted-foreground">
              Annual self-certification (4.26), mis-selling / third-party-payment / legal incidents
              (4.17–4.20b, 6.x) and unsuitability acknowledgements (2.4b).
            </div>
          </div>
        </div>
        <span className="inline-flex items-center gap-1 text-sm font-semibold text-brand-cyan-deep whitespace-nowrap">
          Open registers <ArrowRight className="size-4 group-hover:translate-x-0.5 transition-transform" />
        </span>
      </Link>

      <div className="border rounded-lg p-6 bg-gradient-to-br from-emerald-50 to-blue-50 dark:from-emerald-950/20 dark:to-blue-950/20">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-muted-foreground">DDQ readiness score</div>
            <div className="text-5xl font-bold mt-1">{overallScore}<span className="text-2xl text-muted-foreground">/100</span></div>
            <div className="text-sm text-muted-foreground mt-2 flex items-center gap-2 flex-wrap">
              <span>
                Last computed: {scoreData?.computedAt ? formatRelative(scoreData.computedAt) : "never"}
              </span>
              <span>·</span>
              <RecalculateButton />
            </div>
          </div>
          <ShieldCheck className="size-16 text-emerald-600/40" />
        </div>
        <div className="grid grid-cols-4 gap-3 mt-6">
          <ScoreCard label="NISM validity" score={nismValidity} />
          <ScoreCard label="ARN renewal" score={arnRenewalStatus} />
          <ScoreCard label="KYD docs" score={kydCompleteness} />
          <ScoreCard label="Complaint register" score={complaintRegisterCurrency} />
          <ScoreCard label="Empanelment docs" score={empanelmentCompleteness} />
          <ScoreCard label="SOP sign-off" score={sopSignoffCoverage} />
          <ScoreCard label="Audit trail" score={auditTrailIntegrity} />
          <ScoreCard label="Consent ledger" score={consentLedger} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="border rounded-lg bg-card p-5">
          <h2 className="font-semibold flex items-center gap-2 mb-3">
            <AlertTriangle className="size-4 text-amber-600" /> Expiry watch
          </h2>
          <ul className="space-y-2 text-sm">
            {watchlist.length === 0 ? (
              <li className="text-xs text-muted-foreground py-2">
                No upcoming ARN / NISM / EUIN / CKYC / empanelment expiries on record.
              </li>
            ) : (
              watchlist.slice(0, 5).map((item, idx) => (
                <ExpiryRow key={idx} type={item.type} who={item.who} when={item.when} urgent={item.urgent} />
              ))
            )}
          </ul>
        </div>
        <div className="border rounded-lg bg-card p-5">
          <h2 className="font-semibold flex items-center gap-2 mb-3">
            <FileText className="size-4 text-slate-700" /> Pending approvals
          </h2>
          <ul className="space-y-2 text-sm">
            {pendingTemplates.length === 0 ? (
              <li className="text-xs text-muted-foreground py-2">
                No templates awaiting compliance approval.
              </li>
            ) : (
              pendingTemplates.map((t) => (
                <li key={t.id} className="flex items-center justify-between py-1.5 border-b last:border-0">
                  <div>
                    <span className="font-medium text-slate-800">Marketing template</span>{" "}
                    <span className="text-muted-foreground font-mono text-xs">— {t.key} (v{t.versionNumber})</span>
                  </div>
                  <Link href={`/dashboard/templates/${t.id}?v=${t.versionNumber}`} className="text-xs text-primary hover:underline font-semibold">
                    Review
                  </Link>
                </li>
              ))
            )}
          </ul>
        </div>
      </div>

      <div className="border rounded-lg bg-card p-5">
        <h2 className="font-semibold flex items-center gap-2 mb-3">
          <FileCheck className="size-4" /> Recent audit trail
        </h2>
        <ul className="space-y-1 text-xs font-mono">
          {auditTrailItems.length === 0 ? (
            <li className="py-1 text-muted-foreground font-sans">No audit events recorded yet.</li>
          ) : (
            auditTrailItems.map((item) => (
              <li key={item.id} className="py-1 border-b last:border-0">
                <span className="text-muted-foreground">{item.atStr}</span> · <span className="text-amber-800 dark:text-amber-400 font-semibold">{item.actorType}</span> · <span className="font-medium">{item.actorName}</span> · {item.action}
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}

function ScoreCard({ label, score }: { label: string; score: number }) {
  const color = score >= 90 ? "bg-emerald-500" : score >= 70 ? "bg-amber-500" : "bg-rose-500";
  return (
    <div className="bg-background/50 rounded-md p-3 border">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="flex items-center gap-2 mt-1">
        <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
          <div className={`h-full ${color}`} style={{ width: `${score}%` }} />
        </div>
        <span className="text-xs font-semibold tabular-nums">{score}</span>
      </div>
    </div>
  );
}

function ExpiryRow({ type, who, when, urgent }: { type: string; who: string; when: string; urgent?: boolean }) {
  return (
    <li className="flex items-center justify-between py-1.5 border-b last:border-0">
      <div>
        <span className="font-medium">{type}</span>{" "}
        <span className="text-muted-foreground">— {who}</span>
      </div>
      <span className={`text-xs ${urgent ? "text-rose-600 font-medium" : "text-muted-foreground"}`}>
        {when}
      </span>
    </li>
  );
}

