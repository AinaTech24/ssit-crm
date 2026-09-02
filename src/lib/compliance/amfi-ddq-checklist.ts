/**
 * AMFI Due-Diligence Audit Checklist — the ~40 items an MFD must produce for
 * an AMFI DDQ audit, adopted from the "AMFI Audit Checklist" master.
 *
 * Each item maps to:
 *   - ddqRef    : the DDQ questionnaire section number (1.2, 2.2, 3.6, …)
 *   - section   : the 6 audit sections (I–VI)
 *   - href      : where in THIS app the evidence lives (null = maintained as a
 *                 document/SOP outside a dedicated module)
 *   - coverage  : 'in_app' (the platform produces/holds the evidence) |
 *                 'document' (a file/SOP the firm uploads or maintains)
 *
 * Pure data. Drives the audit-checklist page + the real DDQ readiness %.
 */

export type DdqCoverage = "in_app" | "document";

export type DdqSection = {
  key: string; // 'I' … 'VI'
  title: string;
};

export const DDQ_SECTIONS: DdqSection[] = [
  { key: "I", title: "Information about Distributor" },
  { key: "II", title: "MF Business Activities" },
  { key: "III", title: "Operations & Customer Service" },
  { key: "IV", title: "Compliance & Risk Management" },
  { key: "V", title: "HR Management" },
  { key: "VI", title: "Legal & General" },
];

export type DdqItem = {
  key: string; // stable slug, used as the status row key
  section: string; // section key (I…VI)
  ddqRef: string; // DDQ questionnaire reference, e.g. "1.2"
  title: string;
  href: string | null; // in-app evidence location
  hrefLabel?: string;
  coverage: DdqCoverage;
  note?: string;
};

export const DDQ_ITEMS: DdqItem[] = [
  // ───────────── I — Information about Distributor ─────────────
  { key: "arn_initial", section: "I", ddqRef: "1.2", title: "ARN Card / AMFI Certificate — Initial", href: "/dashboard/legal-registrations", coverage: "document", note: "Initial ARN card (physical + soft copy)" },
  { key: "arn_current", section: "I", ddqRef: "1.2", title: "ARN Card / AMFI Certificate — Current", href: "/dashboard/reports/arn-euin-tracker", hrefLabel: "ARN/EUIN tracker", coverage: "in_app", note: "Current ARN with renewal date tracked" },
  { key: "shop_estd", section: "I", ddqRef: "1.3", title: "Shop & Establishment Certificate (Individuals)", href: "/dashboard/legal-registrations", coverage: "document", note: "As applicable" },
  { key: "roc_moa_aoa", section: "I", ddqRef: "1.4", title: "ROC Certificate / MOA & AOA (Corporates)", href: "/dashboard/legal-registrations", coverage: "document", note: "As applicable" },
  { key: "other_regulators", section: "I", ddqRef: "1.6", title: "Registration with Other Regulators", href: "/dashboard/legal-registrations", coverage: "in_app" },
  { key: "associates_subsidiaries", section: "I", ddqRef: "1.12", title: "List of Associates & Subsidiaries", href: "/dashboard/legal-registrations", coverage: "document", note: "As applicable" },
  { key: "org_chart", section: "I", ddqRef: "1.8", title: "Organisation Chart of Team / Staff", href: "/dashboard/employees", coverage: "in_app" },
  { key: "employees_jd", section: "I", ddqRef: "1.9", title: "List of Employees & Job Descriptions", href: "/dashboard/employees", coverage: "in_app" },
  { key: "amfi_certs_team", section: "I", ddqRef: "1.12", title: "AMFI Certificates of Employees / Sub-Distributors", href: "/dashboard/reports/arn-euin-tracker", hrefLabel: "ARN/EUIN tracker", coverage: "in_app" },
  { key: "euin_team", section: "I", ddqRef: "4.4 / 4.5 / 4.6", title: "EUIN & details of all Employees / Sub-Distributors", href: "/dashboard/reports/arn-euin-tracker", hrefLabel: "ARN/EUIN tracker", coverage: "in_app" },
  { key: "amcs_empanelled", section: "I", ddqRef: "1.11", title: "List of AMCs empanelled / affiliated", href: "/dashboard/amc-empanelments", coverage: "in_app" },
  { key: "services_list", section: "I", ddqRef: "1.7", title: "List & nature of services provided to clients", href: "/dashboard/product-offerings", coverage: "in_app" },

  // ───────────── II — MF Business Activities ─────────────
  { key: "customer_tx_log", section: "II", ddqRef: "3.2", title: "Sample customer log of advisory/execution transactions", href: "/dashboard/transactions", coverage: "in_app" },
  { key: "selection_procedure", section: "II", ddqRef: "2.2", title: "Procedure for selection / deselection of MF products", href: "/dashboard/reports/mf-selection-criteria", hrefLabel: "MF selection criteria", coverage: "in_app" },
  { key: "selection_communication", section: "II", ddqRef: "2.2", title: "Communication to customers on product-selection process", href: "/dashboard/sops", coverage: "document" },
  { key: "commissions_3fy", section: "II", ddqRef: "NA", title: "Commissions from AMCs — aggregate / AMC-wise (last 3 FYs)", href: "/dashboard/commission-reconciliation", coverage: "in_app" },
  { key: "pnl_3y", section: "II", ddqRef: "NA", title: "P&L statement / accounting records / IT returns (3 years)", href: "/dashboard/finances/pnl", coverage: "in_app" },
  { key: "aum_per_amc", section: "II", ddqRef: "NA", title: "AUM numbers with each fund house", href: "/dashboard/reports/shortlisted-schemes", hrefLabel: "AMC reports", coverage: "in_app" },
  { key: "customer_profiling", section: "II", ddqRef: "2.2", title: "Customer profiling process & form", href: "/dashboard/investors", coverage: "in_app" },
  { key: "risk_profiling", section: "II", ddqRef: "2.2", title: "Investor risk-profiling process & form", href: "/dashboard/risk-profiles", coverage: "in_app" },
  { key: "folio_stats", section: "II", ddqRef: "NA", title: "Folio stats & break-up (Individual / Non-Individual)", href: "/dashboard/investors", coverage: "in_app" },

  // ───────────── III — Operations & Customer Service ─────────────
  { key: "platform_used", section: "III", ddqRef: "3.1", title: "Details of platform used for placing MF transactions", href: "/dashboard/tech-stack", hrefLabel: "Tech stack", coverage: "in_app" },
  { key: "ipv_sop", section: "III", ddqRef: "3.1 / 4.2", title: "SOP for conducting IPV of customers", href: "/dashboard/sops", coverage: "document" },
  { key: "onboarding_form", section: "III", ddqRef: "3.1 / 4.2", title: "Client onboarding form / application format", href: "/dashboard/onboarding", coverage: "in_app" },
  { key: "record_keeping", section: "III", ddqRef: "3.2", title: "Record keeping (online/physical) of daily transactions", href: "/dashboard/transactions", coverage: "in_app" },
  { key: "comm_mechanism", section: "III", ddqRef: "2.4", title: "Customer communication mechanism for important/compliance updates", href: "/dashboard/communications/cadence", hrefLabel: "Communication cadence", coverage: "in_app" },
  { key: "feedback_grievance_policy", section: "III", ddqRef: "3.6", title: "Policy & process for customer feedback & grievance", href: "/dashboard/complaints", coverage: "in_app" },
  { key: "feedback_samples", section: "III", ddqRef: "3.5", title: "Samples of customer feedback & grievances", href: "/dashboard/complaints", coverage: "in_app" },
  { key: "portfolio_review_sop", section: "III", ddqRef: "2.2", title: "SOP for client portfolio review", href: "/dashboard/review-meetings", coverage: "in_app" },
  { key: "customer_list", section: "III", ddqRef: "4.17", title: "List of all customers and details", href: "/dashboard/investors", coverage: "in_app" },
  { key: "grievance_redressal", section: "III", ddqRef: "3.6", title: "Customer grievance redressal mechanism", href: "/dashboard/complaints", coverage: "in_app" },

  // ───────────── IV — Compliance & Risk Management ─────────────
  { key: "marketing_samples", section: "IV", ddqRef: "4.11 / 5.1", title: "Details & samples of marketing / adverts used", href: "/dashboard/campaigns", coverage: "in_app" },
  { key: "client_compliance_status", section: "IV", ddqRef: "4.16", title: "Clients compliance status (KYC / PAN / UBO / FATCA)", href: "/dashboard/reports/kyc-tracker", hrefLabel: "KYC tracker", coverage: "in_app" },
  { key: "disclosures", section: "IV", ddqRef: "4.9 / 5.10", title: "Disclosures to customers (incl. commission disclosure)", href: "/dashboard/templates", coverage: "in_app" },
  { key: "audit_report", section: "IV", ddqRef: "", title: "Audit report of last 2–3 years", href: null, coverage: "document", note: "If applicable" },
  { key: "data_security_cert", section: "IV", ddqRef: "4.17 / 4.18", title: "Client data-security certificate", href: null, coverage: "document" },

  // ───────────── V — HR Management ─────────────
  { key: "hr_policy", section: "V", ddqRef: "5.1", title: "HR policy", href: "/dashboard/sops", coverage: "document" },
  { key: "amfi_cert_tracking", section: "V", ddqRef: "4.4 / 4.5 / 4.6", title: "AMFI certification tracking file", href: "/dashboard/reports/arn-euin-tracker", hrefLabel: "ARN/EUIN tracker", coverage: "in_app" },
  { key: "compensation_policy", section: "V", ddqRef: "NA", title: "Compensation policy (if any)", href: "/dashboard/employees", coverage: "document" },
  { key: "perf_review_form", section: "V", ddqRef: "5.2", title: "Employee performance-review form", href: "/dashboard/employees", coverage: "document" },
  { key: "reg_trainings", section: "V", ddqRef: "5.3 / 5.4 / 5.11", title: "Employee regulatory trainings / updates", href: "/dashboard/sops", coverage: "document" },
  { key: "training_calendar", section: "V", ddqRef: "5.3 / 5.4 / 5.11", title: "Training done & training calendar (team & self)", href: "/dashboard/sops", coverage: "document" },
  { key: "subdist_agreement", section: "V", ddqRef: "5.9", title: "Sub-distributor agreement copy", href: "/dashboard/sub-distributors", coverage: "in_app", note: "If applicable" },

  // ── Items added from the AMFI DDQ questionnaire itself (registers built in
  //    migration 0195). These were asked by the DDQ but had no home in the app.
  { key: "relationship_category", section: "II", ddqRef: "2.1c", title: "Client relationship categorisation (execution-only / incidental advice / advisory)", href: "/dashboard/compliance/registers", hrefLabel: "Registers", coverage: "in_app" },
  { key: "no_execution_fees", section: "II", ddqRef: "2.4c", title: "No fees collected for execution services", href: "/dashboard/compliance/registers", hrefLabel: "Registers", coverage: "in_app", note: "Must remain No on the incidental-advice model" },
  { key: "unsuitability_acks", section: "II", ddqRef: "2.4b", title: "Unsuitability communicated, acknowledged & 'execution only' confirmed", href: "/dashboard/compliance/registers", hrefLabel: "Registers", coverage: "in_app" },
  { key: "ubo_collected", section: "IV", ddqRef: "4.11c", title: "UBO details collected (non-individual clients)", href: "/dashboard/reports/kyc-tracker", hrefLabel: "KYC tracker", coverage: "in_app" },
  { key: "ipv_done", section: "IV", ddqRef: "4.13", title: "In-Person Verification (IPV) performed & recorded", href: "/dashboard/reports/kyc-tracker", hrefLabel: "KYC tracker", coverage: "in_app" },
  { key: "misselling_register", section: "IV", ddqRef: "4.17 / 4.18", title: "Mis-selling register (complaints, last 3 years)", href: "/dashboard/compliance/registers", hrefLabel: "Registers", coverage: "in_app" },
  { key: "third_party_payments", section: "IV", ddqRef: "4.20b", title: "Third-party payment monitoring & reporting to AMC", href: "/dashboard/compliance/registers", hrefLabel: "Registers", coverage: "in_app" },
  { key: "dsc_self", section: "IV", ddqRef: "4.26a", title: "Annual Declaration of Self-Certification filed (own ARN)", href: "/dashboard/compliance/registers", hrefLabel: "Registers", coverage: "in_app" },
  { key: "dsc_subdistributors", section: "IV", ddqRef: "4.26b", title: "Annual DSC obtained from every sub-distributor", href: "/dashboard/compliance/registers", hrefLabel: "Registers", coverage: "in_app", note: "If applicable" },
  { key: "amfi_tagline", section: "V", ddqRef: "5.8", title: "'AMFI-registered Mutual Fund Distributor' tagline (font ≥ 12) on all communication", href: "/dashboard/settings/firm-profile", hrefLabel: "Firm profile", coverage: "in_app" },
  { key: "social_media_disclosure", section: "V", ddqRef: "5.9", title: "Registered name + registration number disclosed on social media (SEBI Feb-2026)", href: "/dashboard/settings/firm-profile", hrefLabel: "Firm profile", coverage: "in_app" },
  { key: "customer_litigation", section: "VI", ddqRef: "6.2", title: "Customer litigation / consumer-forum register (5 years)", href: "/dashboard/compliance/registers", hrefLabel: "Registers", coverage: "in_app", note: "If applicable" },
  { key: "arn_suspension_warnings", section: "VI", ddqRef: "6.3", title: "ARN/EUIN suspension + warning letters register (3 years)", href: "/dashboard/compliance/registers", hrefLabel: "Registers", coverage: "in_app", note: "If applicable" },

  // ───────────── VI — Legal & General ─────────────
  { key: "regulatory_actions", section: "VI", ddqRef: "6.1", title: "List / notes of any regulatory actions taken (3 years)", href: null, coverage: "document", note: "If applicable" },
  { key: "annual_reports", section: "VI", ddqRef: "NA", title: "Annual reports of last 3 years (corporates)", href: null, coverage: "document", note: "If applicable" },
  { key: "branches", section: "VI", ddqRef: "NA", title: "Details of branches (if any)", href: "/dashboard/settings", coverage: "in_app" },
  { key: "software_list", section: "VI", ddqRef: "4.2", title: "List of software / apps used to service clients", href: "/dashboard/tech-stack", hrefLabel: "Tech stack", coverage: "in_app" },
];

export type DdqStatus = "in_place" | "in_progress" | "pending" | "not_applicable";

export const DDQ_STATUS_LABELS: Record<DdqStatus, string> = {
  in_place: "In place",
  in_progress: "In progress",
  pending: "Pending",
  not_applicable: "N/A",
};

/**
 * Readiness % = items "in place" / items that count (everything except N/A).
 * Pending/in-progress count against you; N/A is excluded from the denominator.
 */
export function ddqReadiness(statusByKey: Record<string, DdqStatus>): {
  pct: number;
  inPlace: number;
  counted: number;
  pending: number;
  inProgress: number;
  na: number;
} {
  let inPlace = 0, pending = 0, inProgress = 0, na = 0;
  for (const item of DDQ_ITEMS) {
    const s = statusByKey[item.key] ?? "pending";
    if (s === "in_place") inPlace++;
    else if (s === "pending") pending++;
    else if (s === "in_progress") inProgress++;
    else if (s === "not_applicable") na++;
  }
  const counted = DDQ_ITEMS.length - na;
  const pct = counted > 0 ? Math.round((inPlace / counted) * 100) : 0;
  return { pct, inPlace, counted, pending, inProgress, na };
}
