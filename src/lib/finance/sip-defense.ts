/**
 * SIP-book defence — PREDICTIVE SIP-stoppage detection.
 *
 * The existing sip_rejections module is REACTIVE: it kicks in after an
 * installment has already bounced. This finds active SIPs that are *likely* to
 * stop BEFORE they fail, so the RM can intervene and save the trail:
 *
 *   - dead_mandate     : the linked mandate is expired / rejected / cancelled
 *   - mandate_expiring : mandate expires within 30 days
 *   - repeated_failures: 2+ consecutive failed installments
 *   - ending_soon      : SIP end date within 60 days (renewal opportunity)
 *
 * Each at-risk SIP carries a risk level + the annualised installment value and
 * the trail that's exposed, so the owner can prioritise the biggest savings.
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { sipAnnualAmount, FALLBACK_TRAIL } from "@/lib/finance/trail-rates";

export type SipRiskReason = "dead_mandate" | "mandate_expiring" | "repeated_failures" | "ending_soon";

export const SIP_RISK_LABEL: Record<SipRiskReason, string> = {
  dead_mandate: "Dead mandate",
  mandate_expiring: "Mandate expiring",
  repeated_failures: "Repeated failures",
  ending_soon: "Ending soon",
};

export type AtRiskSip = {
  sipId: string;
  investorId: string;
  investorName: string;
  phone: string | null;
  whatsappPhone: string | null;
  schemeName: string | null;
  amcName: string | null;
  amount: number;
  frequency: string;
  annualValue: number;
  annualTrailExposed: number;
  endDate: string | null;
  nextInstallmentAt: string | null;
  failures: number;
  mandateStatus: string | null;
  mandateExpiresAt: string | null;
  rmId: string | null;
  rmName: string | null;
  reasons: SipRiskReason[];
  riskLevel: "high" | "medium";
};

export type SipDefenceSummary = {
  atRisk: AtRiskSip[];
  counts: { total: number; high: number; medium: number };
  monthlyValueAtRisk: number; // sum of monthly-equivalent installments at risk
  annualTrailAtRisk: number;
};

const HIGH_REASONS: SipRiskReason[] = ["dead_mandate", "repeated_failures"];

export async function findAtRiskSips(
  tx: Tx,
  tenantId: string,
  opts: { rmId?: string | null } = {}
): Promise<SipDefenceSummary> {
  // When rmId is set (a non-manager), restrict to that RM's book — the SIPs they
  // own OR for a client they manage.
  const scope = opts.rmId
    ? sql` AND (s.rm_id = ${opts.rmId}::uuid OR i.rm_id = ${opts.rmId}::uuid)`
    : sql``;
  const res = await tx.execute(sql`
    SELECT s.id,
           s.amount::numeric AS amount,
           s.frequency,
           s.end_date,
           s.next_installment_at,
           COALESCE(NULLIF(s.consecutive_failures, '')::int, 0) AS failures,
           s.scheme_name,
           s.amc_name,
           s.rm_id,
           i.id AS investor_id,
           i.name AS investor_name,
           i.phone,
           i.whatsapp_phone,
           m.status AS mandate_status,
           m.expires_at AS mandate_expires_at
    FROM sips s
    JOIN investors i ON i.id = s.investor_id
    LEFT JOIN mandates m ON m.id = s.mandate_id
    WHERE s.tenant_id = ${tenantId} AND s.status = 'active' AND i.deleted_at IS NULL${scope}
  `);

  const rmRes = await tx.execute(sql`SELECT id, name FROM users WHERE tenant_id = ${tenantId}`);
  const rmName = new Map<string, string>();
  for (const r of rmRes.rows as any[]) rmName.set(r.id, r.name);

  const atRisk: AtRiskSip[] = [];

  for (const r of res.rows as any[]) {
    const reasons: SipRiskReason[] = [];
    const failures = Number(r.failures ?? 0);
    const mandateStatus: string | null = r.mandate_status ?? null;

    if (mandateStatus && ["expired", "rejected", "cancelled"].includes(mandateStatus)) {
      reasons.push("dead_mandate");
    }
    if (failures >= 2) reasons.push("repeated_failures");
    if (withinDays(r.mandate_expires_at, 30)) reasons.push("mandate_expiring");
    if (withinDays(r.end_date, 60)) reasons.push("ending_soon");

    if (reasons.length === 0) continue;

    const amount = Number(r.amount ?? 0);
    const annualValue = sipAnnualAmount(amount, r.frequency);
    const riskLevel = reasons.some((x) => HIGH_REASONS.includes(x)) ? "high" : "medium";

    atRisk.push({
      sipId: r.id,
      investorId: r.investor_id,
      investorName: r.investor_name,
      phone: r.phone ?? null,
      whatsappPhone: r.whatsapp_phone ?? null,
      schemeName: r.scheme_name ?? null,
      amcName: r.amc_name ?? null,
      amount,
      frequency: r.frequency ?? "monthly",
      annualValue,
      annualTrailExposed: annualValue * FALLBACK_TRAIL.equity,
      endDate: r.end_date ?? null,
      nextInstallmentAt: r.next_installment_at ?? null,
      failures,
      mandateStatus,
      mandateExpiresAt: r.mandate_expires_at ?? null,
      rmId: r.rm_id ?? null,
      rmName: r.rm_id ? rmName.get(r.rm_id) ?? "Unknown RM" : null,
      reasons,
      riskLevel,
    });
  }

  // High risk first, then by trail exposed.
  atRisk.sort((a, b) => {
    if (a.riskLevel !== b.riskLevel) return a.riskLevel === "high" ? -1 : 1;
    return b.annualTrailExposed - a.annualTrailExposed;
  });

  const monthlyValueAtRisk = atRisk.reduce((s, x) => s + x.annualValue / 12, 0);
  const annualTrailAtRisk = atRisk.reduce((s, x) => s + x.annualTrailExposed, 0);

  return {
    atRisk,
    counts: {
      total: atRisk.length,
      high: atRisk.filter((x) => x.riskLevel === "high").length,
      medium: atRisk.filter((x) => x.riskLevel === "medium").length,
    },
    monthlyValueAtRisk,
    annualTrailAtRisk,
  };
}

// Date helpers — compare a date-ish value to a window from "now".
function withinDays(value: string | Date | null | undefined, days: number): boolean {
  if (!value) return false;
  const d = new Date(value);
  if (isNaN(d.getTime())) return false;
  const now = nowMs();
  const horizon = now + days * 24 * 60 * 60 * 1000;
  // At risk if it falls between now and the horizon, OR is already past.
  return d.getTime() <= horizon;
}

// This is a normal server module (route handler / page), so Date is fine here.
function nowMs(): number {
  return Date.now();
}
