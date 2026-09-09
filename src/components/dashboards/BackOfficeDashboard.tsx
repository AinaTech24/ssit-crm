import Link from "next/link";
import { sql } from "drizzle-orm";
import { ClipboardList, AlertCircle, FileWarning } from "lucide-react";
import { withTenant } from "@/db/client";
import { formatINR } from "@/lib/utils";
import type { SessionUser } from "@/lib/auth/session";
import { OnboardingFunnelChart } from "./OnboardingFunnelChart";
import { BackOfficeInsightsSection } from "./BackOfficeInsightsSection";

/** The four books back office works, as returned by the raw `tx.execute`. */
type BackOfficeBook = {
  clients: number;
  tasks_open: number;
  tasks_overdue: number;
  sr_open: number;
  entries_mtd: number;
  gross_mtd: string;
};

/**
 * Back office dashboard — operational queues.
 * Per spec section 2:
 *   KYC pending · UCC/CAN pending · Mandate pending · SIP registration pending
 *   Service requests pending · Nominee update pending · Bank update pending
 *   Minor to major cases · SIP rejection cases · Document pending list
 */
export async function BackOfficeDashboard({ session }: { session: SessionUser }) {
  const data = await withTenant(session.tenantId, async (tx) => {
    const r = await tx.execute(sql`
      SELECT
        (SELECT COUNT(*)::int FROM investors WHERE kyc_status IN ('pending', 'expired') AND deleted_at IS NULL) AS kyc_pending,
        (SELECT COUNT(*)::int FROM mandates WHERE status = 'pending') AS mandate_pending,
        (SELECT COUNT(*)::int FROM sips WHERE status = 'pending') AS sip_reg_pending,
        (SELECT COUNT(*)::int FROM sips WHERE status IN ('rejected', 'paused')) AS sip_issues,
        (SELECT COUNT(*)::int FROM transactions WHERE status = 'rejected'
            AND created_at >= now() - interval '7 days') AS rejected_tx_7d,
        (SELECT COUNT(*)::int FROM service_requests WHERE status IN ('open', 'in_progress')) AS sr_pending,
        (SELECT COUNT(*)::int FROM service_requests
            WHERE status IN ('open', 'in_progress')
              AND sla_resolution_at < now()) AS sr_breached,
        (SELECT COUNT(*)::int FROM investors WHERE (nominee_name IS NULL OR nominee_name = '') AND deleted_at IS NULL) AS nominee_pending,
        (SELECT COUNT(*)::int FROM investors WHERE is_minor = true
            AND deleted_at IS NULL
            AND dob IS NOT NULL
            AND dob >= current_date - interval '18 years 90 days'
            AND dob < current_date - interval '18 years') AS minor_to_major,
        (SELECT COUNT(*)::int FROM investors WHERE (bank_account_masked IS NULL OR bank_account_masked = '') AND deleted_at IS NULL) AS bank_pending,
        (SELECT COUNT(*)::int FROM mandates WHERE status = 'rejected') AS mandate_rejected
    `);
    const s = r.rows[0] as any;

    const recentSr = await tx.execute(sql`
      SELECT sr.id, sr.ticket_no, sr.subject, sr.type, sr.status, sr.sla_resolution_at,
             i.name AS investor_name
      FROM service_requests sr
      LEFT JOIN investors i ON i.id = sr.investor_id
      WHERE sr.status IN ('open', 'in_progress')
      ORDER BY sr.sla_resolution_at ASC NULLS LAST
      LIMIT 10
    `);

    // Onboarding bottleneck funnel data
    const onboardingStats = await tx.execute(sql`
      SELECT current_stage_key, COUNT(*)::int AS count
      FROM lead_blueprint_instances lbi
      INNER JOIN leads l ON l.id = lbi.lead_id
      WHERE lbi.status = 'in_progress'
        AND l.converted_investor_id IS NOT NULL
      GROUP BY current_stage_key
    `);

    const stageCounts: Record<string, number> = {};
    for (const row of onboardingStats.rows as any[]) {
      stageCounts[row.current_stage_key] = Number(row.count);
    }

    const getCount = (keys: string[]) => keys.reduce((sum, k) => sum + (stageCounts[k] || 0), 0);

    const funnelData = [
      { name: "1. Request Docs", value: getCount(["request_documents", "documents_pending"]), percentage: 0 },
      { name: "2. Docs Received", value: getCount(["documents_received"]), percentage: 0 },
      { name: "3. KYC Process", value: getCount(["kyc_validated", "kyc_registered", "kyc_pending", "modify_kyc", "physical_kyc", "online_kyc"]), percentage: 0 },
      { name: "4. UCC BSE/NSE", value: getCount(["ucc_create", "ucc_activated"]), percentage: 0 },
      { name: "5. SIP Mandate", value: getCount(["mandate_create", "mandate_activated", "mandate_rejected"]), percentage: 0 },
      { name: "6. First Purchase", value: getCount(["make_transaction", "transaction_successful", "transaction_failed", "family_mapping", "update_information", "add_in_review_sheet"]), percentage: 0 },
    ];

    const totalOnboarding = funnelData.reduce((sum, d) => sum + d.value, 0);
    funnelData.forEach(d => {
      d.percentage = totalOnboarding > 0 ? (d.value / totalOnboarding) * 100 : 0;
    });

    return {
      kycPending: Number(s.kyc_pending),
      mandatePending: Number(s.mandate_pending),
      sipRegPending: Number(s.sip_reg_pending),
      sipIssues: Number(s.sip_issues),
      rejectedTx7d: Number(s.rejected_tx_7d),
      srPending: Number(s.sr_pending),
      srBreached: Number(s.sr_breached),
      nomineePending: Number(s.nominee_pending),
      minorToMajor: Number(s.minor_to_major),
      bankPending: Number(s.bank_pending),
      mandateRejected: Number(s.mandate_rejected),
      recentSr: recentSr.rows as any[],
      funnelData,
      totalOnboarding,
      book: (await tx.execute(sql`
        SELECT
          (SELECT count(*)::int FROM investors
            WHERE status = 'active' AND deleted_at IS NULL)                       AS clients,
          (SELECT count(*)::int FROM tasks
            WHERE status IN ('open', 'in_progress') AND deleted_at IS NULL)       AS tasks_open,
          (SELECT count(*)::int FROM tasks
            WHERE status IN ('open', 'in_progress') AND deleted_at IS NULL
              AND due_at IS NOT NULL AND due_at < now())                          AS tasks_overdue,
          (SELECT count(*)::int FROM service_requests
            WHERE status NOT IN ('resolved', 'closed'))                           AS sr_open,
          (SELECT count(*)::int FROM business_entries
            WHERE status <> 'cancelled'
              AND business_date >= date_trunc('month', current_date))             AS entries_mtd,
          (SELECT COALESCE(SUM(total_amount), 0)::numeric FROM business_entries
            WHERE status <> 'cancelled'
              AND business_date >= date_trunc('month', current_date))             AS gross_mtd
      `)).rows[0] as unknown as BackOfficeBook | undefined,
    };
  }, { userId: session.userId, branchId: session.branchId, roles: session.roles });

  return (
    <div className="space-y-6 max-w-7xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Operations queues</h1>
        <p className="text-muted-foreground text-sm">All the things waiting on the back office.</p>
      </div>

      {/* The four books back office works, before the exception queues below.
          Each opens the list it counts. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Queue href="/dashboard/investors" label="All clients" value={Number(data.book?.clients ?? 0)} />
        <Queue
          href="/dashboard/tasks"
          label="Open tasks"
          value={Number(data.book?.tasks_open ?? 0)}
          sub={Number(data.book?.tasks_overdue ?? 0) > 0 ? `${data.book?.tasks_overdue} overdue` : undefined}
          tone={Number(data.book?.tasks_overdue ?? 0) > 0 ? "amber" : "muted"}
        />
        <Queue href="/dashboard/service-requests" label="Service requests" value={Number(data.book?.sr_open ?? 0)} />
        <Queue
          href="/dashboard/business-entries"
          label="Business entries (MTD)"
          value={Number(data.book?.entries_mtd ?? 0)}
          sub={formatINR(Number(data.book?.gross_mtd ?? 0))}
        />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <Queue href="/dashboard/investors?segment=&q=" label="KYC pending" value={data.kycPending} tone={data.kycPending > 0 ? "amber" : "muted"} />
        <Queue href="/dashboard/sips" label="Mandate pending" value={data.mandatePending} tone={data.mandatePending > 0 ? "amber" : "muted"} />
        <Queue href="/dashboard/sips" label="SIP registration pending" value={data.sipRegPending} tone={data.sipRegPending > 0 ? "amber" : "muted"} />
        <Queue href="/dashboard/sip-rejections" label="SIP rejections (7d)" value={data.rejectedTx7d} tone={data.rejectedTx7d > 0 ? "rose" : "muted"} />
        <Queue href="/dashboard/service-requests" label="SLA breached" value={data.srBreached} tone={data.srBreached > 0 ? "rose" : "muted"} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <Queue href="/dashboard/service-requests" label="Service requests open" value={data.srPending} />
        <Queue href="/dashboard/investors" label="Nominee missing" value={data.nomineePending} tone="amber" />
        <Queue href="/dashboard/investors" label="Bank details missing" value={data.bankPending} tone="amber" />
        <Queue href="/dashboard/investors" label="Minor → Major (90d)" value={data.minorToMajor} tone={data.minorToMajor > 0 ? "amber" : "muted"} />
        <Queue href="/dashboard/sips" label="SIP issues (active)" value={data.sipIssues} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 card-surface glass-card p-5">
          <h2 className="font-semibold text-sm tracking-tight text-foreground/90 mb-2">
            Onboarding Bottleneck Funnel
          </h2>
          <OnboardingFunnelChart data={data.funnelData} />
        </div>
        <div className="card-surface glass-card p-5 flex flex-col justify-between">
          <div>
            <h2 className="font-semibold text-sm tracking-tight text-foreground/90 mb-2">
              Onboarding Health
            </h2>
            <p className="text-xs text-muted-foreground leading-relaxed">
              MFD scaling requires automating the onboarding journey. Track the density of clients across phases to trigger automated WhatsApp/Email follow-up checklists when they remain in a stage too long.
            </p>
          </div>
          <div className="space-y-3 mt-4">
            <div className="flex justify-between items-center text-xs p-2.5 rounded bg-muted/30">
              <span className="font-medium">Total in Onboarding</span>
              <span className="font-bold text-brand-cyan-deep">{data.totalOnboarding} Clients</span>
            </div>
            <div className="flex justify-between items-center text-xs p-2.5 rounded bg-muted/30">
              <span className="font-medium">KYC Pending Queue</span>
              <span className="font-bold text-amber-600">{data.kycPending} Accounts</span>
            </div>
            <div className="flex justify-between items-center text-xs p-2.5 rounded bg-muted/30">
              <span className="font-medium">Mandates Rejected</span>
              <span className="font-bold text-rose-600">{data.mandateRejected} Mandates</span>
            </div>
          </div>
        </div>
      </div>

      <div className="card-surface glass-card p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold flex items-center gap-2 text-sm tracking-tight text-foreground/90">
            <ClipboardList className="size-4 text-brand-cyan-deep" /> SLA queue (oldest first)
          </h2>
          <Link href="/dashboard/service-requests" className="text-xs text-brand-cyan-deep hover:underline font-semibold">
            Open all →
          </Link>
        </div>
        {data.recentSr.length === 0 ? (
          <p className="text-sm text-muted-foreground mt-3 text-center py-6">No open service requests. ✓</p>
        ) : (
          <table className="w-full text-sm mt-3 table-modern">
            <thead className="text-xs text-muted-foreground border-b">
              <tr>
                <th className="text-left py-2 px-2 font-medium">Ticket</th>
                <th className="text-left py-2 px-2 font-medium">Subject</th>
                <th className="text-left py-2 px-2 font-medium">Investor</th>
                <th className="text-left py-2 px-2 font-medium">Type</th>
                <th className="text-right py-2 px-2 font-medium">SLA</th>
                <th className="text-right py-2 px-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.recentSr.map((r: any) => {
                const slaMs = r.sla_resolution_at ? new Date(r.sla_resolution_at).getTime() - Date.now() : null;
                const breached = slaMs != null && slaMs < 0;
                return (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="py-2.5 px-2 font-mono text-xs">{r.ticket_no}</td>
                    <td className="py-2.5 px-2 max-w-xs truncate font-medium">{r.subject}</td>
                    <td className="py-2.5 px-2">{r.investor_name ?? "—"}</td>
                    <td className="py-2.5 px-2 text-xs text-muted-foreground">{r.type}</td>
                    <td className="py-2.5 px-2 text-right">
                      {breached ? (
                        <span className="text-xs text-rose-600 flex items-center justify-end gap-1.5 font-semibold">
                          <span className="pulse-danger-dot" /> breached
                        </span>
                      ) : slaMs != null && slaMs < 24 * 60 * 60 * 1000 ? (
                        <span className="text-xs text-amber-600 flex items-center justify-end gap-1.5 font-semibold">
                          <span className="pulse-warning-dot" /> {Math.floor(slaMs / (60 * 60 * 1000))}h
                        </span>
                      ) : slaMs != null ? (
                        <span className="text-xs text-muted-foreground">
                          {Math.floor(slaMs / (60 * 60 * 1000))}h
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-2.5 px-2 text-right">
                      <Link
                        href={`/dashboard/service-requests`}
                        className="btn-ghost text-[10px] py-1 px-2.5 border border-border bg-card rounded-md hover:bg-secondary font-semibold"
                      >
                        Resolve
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ---------- BackOffice Insights — service-impact additions ---------- */}
      <BackOfficeInsightsSection session={session} />
    </div>
  );
}

function Queue({
  href,
  label,
  value,
  sub,
  tone,
}: {
  href: string;
  label: string;
  value: number;
  /** Second line — the amount behind a count, or why it is amber. */
  sub?: string;
  tone?: "rose" | "amber" | "muted";
}) {
  const color = tone === "rose" ? "text-rose-600" : tone === "amber" ? "text-amber-600" : "text-foreground";
  const hasPulse = value > 0 && (tone === "rose" || tone === "amber");
  
  return (
    <Link href={href} className="card-surface glass-card p-4 hover-lift block">
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">{label}</div>
        {hasPulse && (
          <span className={tone === "rose" ? "pulse-danger-dot" : "pulse-warning-dot"} />
        )}
      </div>
      <div className={`text-2xl font-bold mt-2 tracking-tight ${color}`}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
    </Link>
  );
}
