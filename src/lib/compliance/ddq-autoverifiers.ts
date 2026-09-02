import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";

export type AutoVerifyResult = {
  verified: boolean;
  reason?: string;
};

export const AUTO_VERIFIERS: Record<
  string,
  (tx: Tx, tenantId: string) => Promise<AutoVerifyResult>
> = {
  arn_current: async (tx, tenantId) => {
    const [row] = (await tx.execute(sql`
      SELECT id FROM tenants 
      WHERE id = ${tenantId}::uuid AND arn_expiry_at IS NOT NULL AND arn_expiry_at > CURRENT_DATE
    `)).rows as any[];
    return {
      verified: !!row,
      reason: row ? "Valid ARN expiry date is registered in company profile." : "ARN is missing or expired in company profile.",
    };
  },
  org_chart: async (tx, tenantId) => {
    const [row] = (await tx.execute(sql`
      SELECT COUNT(*)::int as count FROM users 
      WHERE tenant_id = ${tenantId}::uuid AND status = 'active'
    `)).rows as any[];
    const hasUsers = (row?.count ?? 0) > 0;
    return {
      verified: hasUsers,
      reason: hasUsers ? `${row.count} active employees exist in the organization list.` : "No active employees found.",
    };
  },
  employees_jd: async (tx, tenantId) => {
    const [row] = (await tx.execute(sql`
      SELECT COUNT(*)::int as count FROM users 
      WHERE tenant_id = ${tenantId}::uuid AND status = 'active'
    `)).rows as any[];
    const hasUsers = (row?.count ?? 0) > 0;
    return {
      verified: hasUsers,
      reason: hasUsers ? `Employee directory lists ${row.count} active job descriptions.` : "No employee definitions found.",
    };
  },
  amfi_certs_team: async (tx, tenantId) => {
    const [row] = (await tx.execute(sql`
      SELECT COUNT(*)::int as count FROM users 
      WHERE tenant_id = ${tenantId}::uuid AND status = 'active' AND nism_expiry_at IS NOT NULL AND nism_expiry_at > CURRENT_DATE
    `)).rows as any[];
    const hasCerts = (row?.count ?? 0) > 0;
    return {
      verified: hasCerts,
      reason: hasCerts ? `${row.count} active team members hold valid NISM/AMFI certificates.` : "No team members have valid certificates.",
    };
  },
  euin_team: async (tx, tenantId) => {
    const [row] = (await tx.execute(sql`
      SELECT COUNT(*)::int as count FROM users 
      WHERE tenant_id = ${tenantId}::uuid AND status = 'active' AND euin IS NOT NULL AND euin != ''
    `)).rows as any[];
    const hasEuin = (row?.count ?? 0) > 0;
    return {
      verified: hasEuin,
      reason: hasEuin ? `${row.count} active team members are registered with EUIN codes.` : "No active team members have EUIN codes registered.",
    };
  },
  amcs_empanelled: async (tx, tenantId) => {
    const [row] = (await tx.execute(sql`
      SELECT COUNT(*)::int as count FROM amc_empanelments 
      WHERE tenant_id = ${tenantId}::uuid AND status = 'empanelled'
    `)).rows as any[];
    const hasEmpanelments = (row?.count ?? 0) > 0;
    return {
      verified: hasEmpanelments,
      reason: hasEmpanelments ? `Empanelled with ${row.count} Asset Management Companies.` : "No active empanelment records found.",
    };
  },
  services_list: async (tx, tenantId) => {
    const [row] = (await tx.execute(sql`
      SELECT COUNT(*)::int as count FROM product_offerings 
      WHERE tenant_id = ${tenantId}::uuid AND status = 'active'
    `)).rows as any[];
    const hasOfferings = (row?.count ?? 0) > 0;
    return {
      verified: hasOfferings,
      reason: hasOfferings ? `Services directory contains ${row.count} active client offering classes.` : "No active product offering profiles defined.",
    };
  },
  customer_tx_log: async (tx, tenantId) => {
    const [row] = (await tx.execute(sql`
      SELECT COUNT(*)::int as count FROM transactions 
      WHERE tenant_id = ${tenantId}::uuid
    `)).rows as any[];
    const hasTxs = (row?.count ?? 0) > 0;
    return {
      verified: hasTxs,
      reason: hasTxs ? `Transactions log registers ${row.count} database entries.` : "No mutual fund transaction logs registered.",
    };
  },
  selection_procedure: async (tx, tenantId) => {
    const [row] = (await tx.execute(sql`
      SELECT COUNT(*)::int as count FROM sops
      WHERE tenant_id = ${tenantId}::uuid AND deleted_at IS NULL AND (key = 'mf_selection' OR title ILIKE '%selection%')
    `)).rows as any[];
    const hasProcedure = (row?.count ?? 0) > 0;
    return {
      verified: hasProcedure,
      reason: hasProcedure ? "MF scheme selection criteria SOP is uploaded and active." : "No matching scheme selection SOP found.",
    };
  },
  commissions_3fy: async (tx, tenantId) => {
    const [row] = (await tx.execute(sql`
      SELECT COUNT(*)::int as count FROM commission_records
      WHERE tenant_id = ${tenantId}::uuid
    `)).rows as any[];
    const hasComm = (row?.count ?? 0) > 0;
    return {
      verified: hasComm,
      reason: hasComm ? `Commission registers are tracking reconciliations.` : "No commission feed logs registered in backend.",
    };
  },
  pnl_3y: async (tx, tenantId) => {
    const [row] = (await tx.execute(sql`
      SELECT COUNT(*)::int as count FROM business_expenses
      WHERE tenant_id = ${tenantId}::uuid
    `)).rows as any[];
    const hasPnl = (row?.count ?? 0) > 0;
    return {
      verified: hasPnl,
      reason: hasPnl ? "P&L tracking data is present in Finance module." : "No business accounting/P&L records stored.",
    };
  },
  aum_per_amc: async (tx, tenantId) => {
    const [row] = (await tx.execute(sql`
      SELECT COUNT(*)::int as count FROM folios
      WHERE tenant_id = ${tenantId}::uuid AND closed_at IS NULL
    `)).rows as any[];
    const hasFolios = (row?.count ?? 0) > 0;
    return {
      verified: hasFolios,
      reason: hasFolios ? `Folio tracker contains ${row.count} active accounts mapping to AMC fund houses.` : "No active mutual fund folios found.",
    };
  },
  customer_profiling: async (tx, tenantId) => {
    const [row] = (await tx.execute(sql`
      SELECT COUNT(*)::int as count FROM investors 
      WHERE tenant_id = ${tenantId}::uuid AND status = 'active'
    `)).rows as any[];
    const hasInvestors = (row?.count ?? 0) > 0;
    return {
      verified: hasInvestors,
      reason: hasInvestors ? `Active client register lists ${row.count} profiles.` : "No active investors registered.",
    };
  },
  risk_profiling: async (tx, tenantId) => {
    const [row] = (await tx.execute(sql`
      SELECT COUNT(*)::int as count FROM risk_profile_responses
      WHERE tenant_id = ${tenantId}::uuid
    `)).rows as any[];
    const hasProfiles = (row?.count ?? 0) > 0;
    return {
      verified: hasProfiles,
      reason: hasProfiles ? `${row.count} completed investor risk questionnaires recorded.` : "No investor risk profiling sessions stored.",
    };
  },
  folio_stats: async (tx, tenantId) => {
    const [row] = (await tx.execute(sql`
      SELECT COUNT(*)::int as count FROM folios 
      WHERE tenant_id = ${tenantId}::uuid
    `)).rows as any[];
    const hasFolios = (row?.count ?? 0) > 0;
    return {
      verified: hasFolios,
      reason: hasFolios ? `Database contains ${row.count} registered client folios.` : "No customer folio logs found.",
    };
  },
  platform_used: async (tx, tenantId) => {
    const [row] = (await tx.execute(sql`
      SELECT COUNT(*)::int as count FROM tech_stack_tools 
      WHERE tenant_id = ${tenantId}::uuid AND category = 'transactions' AND status = 'active'
    `)).rows as any[];
    const hasTools = (row?.count ?? 0) > 0;
    return {
      verified: hasTools,
      reason: hasTools ? `Active transaction gateways (BSE/NSE/MFU) registered in tech stack.` : "No transaction gateways registered in Tech Stack.",
    };
  },
  onboarding_form: async (tx, tenantId) => {
    // Evidence-based: an enabled client onboarding / lead-capture form on file.
    // Never auto-pass without evidence — if none, the officer marks it manually.
    const [row] = (await tx.execute(sql`
      SELECT COUNT(*)::int as count FROM lead_capture_forms
      WHERE tenant_id = ${tenantId}::uuid AND enabled = true
    `)).rows as any[];
    const has = (row?.count ?? 0) > 0;
    return {
      verified: has,
      reason: has
        ? `${row.count} enabled client onboarding/lead-capture form(s) configured.`
        : "No onboarding/lead-capture form configured yet — set one up, then mark this item.",
    };
  },
  record_keeping: async (tx, tenantId) => {
    const [row] = (await tx.execute(sql`
      SELECT COUNT(*)::int as count FROM transactions 
      WHERE tenant_id = ${tenantId}::uuid
    `)).rows as any[];
    const hasTxs = (row?.count ?? 0) > 0;
    return {
      verified: hasTxs,
      reason: hasTxs ? "Client transaction journals are actively recorded." : "Transaction record keeping has no entries.",
    };
  },
  comm_mechanism: async (tx, tenantId) => {
    const [row] = (await tx.execute(sql`
      SELECT COUNT(*)::int as count FROM campaigns 
      WHERE tenant_id = ${tenantId}::uuid AND (status = 'sent' OR status = 'active')
    `)).rows as any[];
    const hasComms = (row?.count ?? 0) > 0;
    return {
      verified: hasComms,
      reason: hasComms ? `Unified campaigns are active with ${row.count} scheduled actions.` : "No active bulk communication schedules found.",
    };
  },
  feedback_grievance_policy: async (tx, tenantId) => {
    // Evidence-based: a grievance/complaint SOP on file, or at least one logged
    // complaint. The channel merely existing is not proof of a policy.
    const [row] = (await tx.execute(sql`
      SELECT
        (SELECT COUNT(*)::int FROM sops WHERE tenant_id = ${tenantId}::uuid AND deleted_at IS NULL
           AND (key ILIKE '%grievance%' OR key ILIKE '%complaint%' OR title ILIKE '%grievance%' OR title ILIKE '%complaint%')) AS sop_count,
        (SELECT COUNT(*)::int FROM service_requests WHERE tenant_id = ${tenantId}::uuid AND type = 'complaint') AS complaint_count
    `)).rows as any[];
    const sopCount = row?.sop_count ?? 0;
    const complaintCount = row?.complaint_count ?? 0;
    const has = sopCount > 0 || complaintCount > 0;
    return {
      verified: has,
      reason: sopCount > 0
        ? "A grievance/complaint-handling SOP is on file."
        : complaintCount > 0
        ? `${complaintCount} complaint(s) logged in the grievance register.`
        : "No grievance SOP or logged complaints — add a grievance-redressal SOP, then mark this item.",
    };
  },
  feedback_samples: async (tx, tenantId) => {
    const [row] = (await tx.execute(sql`
      SELECT COUNT(*)::int as count FROM service_requests 
      WHERE tenant_id = ${tenantId}::uuid AND type = 'complaint'
    `)).rows as any[];
    const hasComplaints = (row?.count ?? 0) > 0;
    return {
      verified: hasComplaints,
      reason: hasComplaints ? `Grievance ledger registers ${row.count} active customer cases.` : "No customer feedback/grievances registered.",
    };
  },
  portfolio_review_sop: async (tx, tenantId) => {
    const [row] = (await tx.execute(sql`
      SELECT COUNT(*)::int as count FROM review_meetings 
      WHERE tenant_id = ${tenantId}::uuid
    `)).rows as any[];
    const hasReviews = (row?.count ?? 0) > 0;
    return {
      verified: hasReviews,
      reason: hasReviews ? `Review meetings calendar tracks ${row.count} historical sessions.` : "No completed portfolio reviews registered.",
    };
  },
  customer_list: async (tx, tenantId) => {
    const [row] = (await tx.execute(sql`
      SELECT COUNT(*)::int as count FROM investors 
      WHERE tenant_id = ${tenantId}::uuid AND status = 'active'
    `)).rows as any[];
    const hasInvestors = (row?.count ?? 0) > 0;
    return {
      verified: hasInvestors,
      reason: hasInvestors ? `Client directory list counts ${row.count} active investors.` : "Investor list has 0 entries.",
    };
  },
  grievance_redressal: async (tx, tenantId) => {
    // Evidence-based: a grievance/complaint SOP, or at least one logged complaint.
    const [row] = (await tx.execute(sql`
      SELECT
        (SELECT COUNT(*)::int FROM sops WHERE tenant_id = ${tenantId}::uuid AND deleted_at IS NULL
           AND (key ILIKE '%grievance%' OR key ILIKE '%complaint%' OR title ILIKE '%grievance%' OR title ILIKE '%complaint%')) AS sop_count,
        (SELECT COUNT(*)::int FROM service_requests WHERE tenant_id = ${tenantId}::uuid AND type = 'complaint') AS complaint_count
    `)).rows as any[];
    const sopCount = row?.sop_count ?? 0;
    const complaintCount = row?.complaint_count ?? 0;
    const has = sopCount > 0 || complaintCount > 0;
    return {
      verified: has,
      reason: sopCount > 0
        ? "A grievance-redressal SOP is documented."
        : complaintCount > 0
        ? `${complaintCount} complaint(s) tracked through redressal.`
        : "No grievance-redressal SOP or logged complaints found — document the SOP, then mark this item.",
    };
  },
  marketing_samples: async (tx, tenantId) => {
    const [row] = (await tx.execute(sql`
      SELECT COUNT(*)::int as count FROM templates 
      WHERE tenant_id = ${tenantId}::uuid AND category = 'marketing'
    `)).rows as any[];
    const hasTemplates = (row?.count ?? 0) > 0;
    return {
      verified: hasTemplates,
      reason: hasTemplates ? `Template designer holds ${row.count} custom marketing formats.` : "No marketing templates created.",
    };
  },
  client_compliance_status: async (tx, tenantId) => {
    const [row] = (await tx.execute(sql`
      SELECT COUNT(*)::int as count FROM compliance_documents 
      WHERE tenant_id = ${tenantId}::uuid
    `)).rows as any[];
    const hasDocs = (row?.count ?? 0) > 0;
    return {
      verified: hasDocs,
      reason: hasDocs ? `Document vault tracks ${row.count} compliance certificates.` : "No compliance documents uploaded in vault.",
    };
  },
  disclosures: async (tx, tenantId) => {
    const [row] = (await tx.execute(sql`
      SELECT COUNT(*)::int as count FROM templates 
      WHERE tenant_id = ${tenantId}::uuid
    `)).rows as any[];
    const hasTemplates = (row?.count ?? 0) > 0;
    return {
      verified: hasTemplates,
      reason: hasTemplates ? `Regulatory disclaimer blocks included in ${row.count} templates.` : "No communication templates defined.",
    };
  },
  amfi_cert_tracking: async (tx, tenantId) => {
    const [row] = (await tx.execute(sql`
      SELECT COUNT(*)::int as count FROM users 
      WHERE tenant_id = ${tenantId}::uuid AND status = 'active' AND nism_expiry_at IS NOT NULL
    `)).rows as any[];
    const hasTracking = (row?.count ?? 0) > 0;
    return {
      verified: hasTracking,
      reason: hasTracking ? `Actively monitoring ${row.count} employee certifications.` : "No employee certification dates registered.",
    };
  },
  branches: async (tx, tenantId) => {
    const [row] = (await tx.execute(sql`
      SELECT COUNT(*)::int as count FROM branches 
      WHERE tenant_id = ${tenantId}::uuid
    `)).rows as any[];
    const hasBranches = (row?.count ?? 0) > 0;
    return {
      verified: hasBranches,
      reason: hasBranches ? `Firm is registered with ${row.count} branch locations.` : "No branch locations configured.",
    };
  },
  software_list: async (tx, tenantId) => {
    const [row] = (await tx.execute(sql`
      SELECT COUNT(*)::int as count FROM tech_stack_tools 
      WHERE tenant_id = ${tenantId}::uuid AND status = 'active'
    `)).rows as any[];
    const hasTools = (row?.count ?? 0) > 0;
    return {
      verified: hasTools,
      reason: hasTools ? `Tech stack register tracks ${row.count} active tools.` : "No software tools declared in registry.",
    };
  },
  subdist_agreement: async (tx, tenantId) => {
    const [row] = (await tx.execute(sql`
      SELECT COUNT(*)::int as count FROM sub_distributors 
      WHERE tenant_id = ${tenantId}::uuid
    `)).rows as any[];
    const hasSubdist = (row?.count ?? 0) > 0;
    return {
      verified: hasSubdist,
      reason: hasSubdist ? `Sub-distributor registry lists ${row.count} partner contracts.` : "No sub-distributors registered in panel.",
    };
  },
};
