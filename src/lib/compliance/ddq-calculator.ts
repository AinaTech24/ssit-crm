import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { ddqScores } from "@/db/schema";

export interface DdqReadinessResult {
  overallScore: number;
  breakdown: {
    nismValidity: number;
    arnRenewalStatus: number;
    kydCompleteness: number;
    complaintRegisterCurrency: number;
    empanelmentCompleteness: number;
    sopSignoffCoverage: number;
    auditTrailIntegrity: number;
    consentLedger: number;
  };
}

/**
 * Scoring note — "not applicable" defaults to 100.
 *
 * Several metrics divide by a population that can be empty (no RMs requiring
 * NISM, no AMC empanelments yet, no complaints filed). In those cases the SQL
 * COALESCEs the ratio to 100, i.e. "nothing to assess ⇒ nothing in breach".
 * This is intentional: a brand-new firm shouldn't be penalised for an empty
 * complaint register. The trade-off is that a genuinely-empty section reads as
 * 100% rather than N/A — the per-item AMFI DDQ checklist (audit-checklist page)
 * is the authoritative gap view; this score is the rollup headline.
 */
export async function calculateDdqScore(tx: Tx, tenantId: string): Promise<DdqReadinessResult> {
  const t = tenantId;

  // 1. NISM Validity: RMs and Compliance staff with valid NISM
  const [nismRow] = (
    await tx.execute(sql`
      SELECT 
        COALESCE(
          ROUND((COUNT(*) FILTER (WHERE nism_expiry_at IS NOT NULL AND nism_expiry_at > CURRENT_DATE)::float / NULLIF(COUNT(*), 0)) * 100),
          100
        )::int AS score
      FROM users 
      WHERE tenant_id = ${t}::uuid 
        AND status = 'active' 
        AND ('rm' = ANY(roles) OR 'compliance' = ANY(roles))
    `)
  ).rows as any[];
  const nismValidity = nismRow?.score ?? 100;

  // 2. ARN Renewal Status: Tenant ARN expiry check
  const [arnRow] = (
    await tx.execute(sql`
      SELECT 
        CASE 
          WHEN arn_expiry_at IS NULL OR arn_expiry_at > CURRENT_DATE THEN 100 
          ELSE 0 
        END AS score 
      FROM tenants 
      WHERE id = ${t}::uuid
    `)
  ).rows as any[];
  const arnRenewalStatus = arnRow?.score ?? 100;

  // 3. KYD Completeness: Unexpired KYD document in vault
  const [kydRow] = (
    await tx.execute(sql`
      SELECT 
        CASE WHEN COUNT(*) > 0 THEN 100 ELSE 0 END AS score 
      FROM compliance_documents 
      WHERE tenant_id = ${t}::uuid 
        AND category = 'kyd' 
        AND (expires_on IS NULL OR expires_on > CURRENT_DATE)
    `)
  ).rows as any[];
  const kydCompleteness = kydRow?.score ?? 0;

  // 4. Complaint Register TAT: resolved in 21 days
  const [complaintRow] = (
    await tx.execute(sql`
      SELECT 
        COALESCE(
          ROUND((COUNT(*) FILTER (WHERE resolved_at IS NOT NULL AND resolved_at - created_at <= interval '21 days')::float / NULLIF(COUNT(*), 0)) * 100), 
          100
        )::int AS score
      FROM service_requests 
      WHERE tenant_id = ${t}::uuid AND type = 'complaint'
    `)
  ).rows as any[];
  const complaintRegisterCurrency = complaintRow?.score ?? 100;

  // 5. Empanelment Completeness: active empanelments with distributor_code and primary contact
  const [empanelmentRow] = (
    await tx.execute(sql`
      SELECT 
        COALESCE(
          ROUND((COUNT(*) FILTER (WHERE distributor_code IS NOT NULL AND (rm_name IS NOT NULL OR ops_name IS NOT NULL))::float / NULLIF(COUNT(*), 0)) * 100), 
          100
        )::int AS score
      FROM amc_empanelments 
      WHERE tenant_id = ${t}::uuid AND status = 'empanelled'
    `)
  ).rows as any[];
  const empanelmentCompleteness = empanelmentRow?.score ?? 100;

  // 6. SOP Sign-off Coverage: dynamic matrix checking roles and versions
  const [sopRow] = (
    await tx.execute(sql`
      WITH required_signoffs AS (
        SELECT 
          u.id AS user_id,
          s.current_version_id AS sop_version_id
        FROM users u
        CROSS JOIN sops s
        WHERE u.tenant_id = ${t}::uuid
          AND u.status = 'active'
          AND s.tenant_id = ${t}::uuid
          AND s.deleted_at IS NULL
          AND s.current_version_id IS NOT NULL
          AND (
            EXISTS (
              SELECT 1 FROM unnest(s.required_roles) AS r
              WHERE r = ANY(u.roles)
            )
            OR s.required_roles IS NULL 
            OR cardinality(s.required_roles) = 0
          )
      ),
      completed_signoffs AS (
        SELECT r.user_id, r.sop_version_id
        FROM required_signoffs r
        INNER JOIN sop_acknowledgements a ON a.user_id = r.user_id AND a.sop_version_id = r.sop_version_id
      )
      SELECT 
        COALESCE(
          ROUND((COUNT(c.user_id)::float / NULLIF(COUNT(r.user_id), 0)) * 100),
          100
        )::int AS score
      FROM required_signoffs r
      LEFT JOIN completed_signoffs c ON c.user_id = r.user_id AND c.sop_version_id = r.sop_version_id
    `)
  ).rows as any[];
  const sopSignoffCoverage = sopRow?.score ?? 100;

  // 7. Audit Trail Integrity: checking audit log presence
  const [auditRow] = (
    await tx.execute(sql`
      SELECT CASE WHEN COUNT(*) > 0 THEN 100 ELSE 50 END AS score 
      FROM audit_log 
      WHERE tenant_id = ${t}::uuid
    `)
  ).rows as any[];
  const auditTrailIntegrity = auditRow?.score ?? 100;

  // 8. Consent Ledger: percentage of active investors with a granted consent
  const [consentRow] = (
    await tx.execute(sql`
      SELECT 
        COALESCE(
          ROUND((COUNT(DISTINCT investor_id)::float / NULLIF((SELECT COUNT(*) FROM investors WHERE tenant_id = ${t}::uuid AND status = 'active'), 0)) * 100),
          100
        )::int AS score
      FROM consents 
      WHERE tenant_id = ${t}::uuid AND status = 'granted'
    `)
  ).rows as any[];
  const consentLedger = consentRow?.score ?? 100;

  const breakdown = {
    nismValidity,
    arnRenewalStatus,
    kydCompleteness,
    complaintRegisterCurrency,
    empanelmentCompleteness,
    sopSignoffCoverage,
    auditTrailIntegrity,
    consentLedger,
  };

  const scores = Object.values(breakdown);
  const overallScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);

  return {
    overallScore,
    breakdown,
  };
}

export async function saveDdqScore(tx: Tx, tenantId: string): Promise<DdqReadinessResult> {
  const result = await calculateDdqScore(tx, tenantId);

  await tx.insert(ddqScores).values({
    tenantId,
    overallScore: String(result.overallScore) as any,
    breakdown: result.breakdown as any,
    computedAt: new Date(),
  });

  return result;
}
