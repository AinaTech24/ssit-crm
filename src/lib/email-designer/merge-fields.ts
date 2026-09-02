/**
 * Merge fields catalog for the email template designer.
 *
 * Each entry declares a merge-token that authors can drop into the email
 * (e.g. `{{investor.name}}`). The category groups them in the UI sidebar.
 *
 * Sources at send time:
 *   - `investor.*`     — the subject when subjectType=investor
 *   - `lead.*`         — the subject when subjectType=lead
 *   - `family.*`       — investor's family (if any)
 *   - `transaction.*`  — the triggering transaction (if any)
 *   - `tenant.*`       — the MFD firm (always available)
 *   - `system.*`       — date, link, etc.
 */

export interface MergeField {
  token: string; // "investor.name"
  label: string;
  example: string;
  category: string;
  /** Fallback used when the field has no value at render time. */
  fallback?: string;
}

export const MERGE_FIELDS: MergeField[] = [
  // ── Recipient (subject — usually investor or lead) ────────────────────────
  { token: "investor.name", label: "Investor name", example: "Rajesh Sharma", category: "Recipient" },
  { token: "investor.first_name", label: "Investor first name", example: "Rajesh", category: "Recipient" },
  { token: "investor.pan", label: "Investor PAN", example: "ABCDE1234F", category: "Recipient" },
  { token: "investor.email", label: "Investor email", example: "rajesh@example.com", category: "Recipient" },
  { token: "investor.phone", label: "Investor phone", example: "+91 98765 43210", category: "Recipient" },
  { token: "investor.segment_tag", label: "Segment", example: "HNI", category: "Recipient" },
  { token: "investor.service_tier", label: "Service tier", example: "A", category: "Recipient" },
  { token: "investor.aum", label: "AUM (₹)", example: "₹1,25,00,000", category: "Recipient" },
  { token: "investor.date_of_birth", label: "Date of birth", example: "15 Aug 1978", category: "Recipient" },
  { token: "investor.rm_name", label: "Relationship manager", example: "Priya Mehta", category: "Recipient" },

  // ── Lead ──────────────────────────────────────────────────────────────────
  { token: "lead.name", label: "Lead name", example: "Anita Desai", category: "Lead" },
  { token: "lead.phone", label: "Lead phone", example: "+91 90000 12345", category: "Lead" },
  { token: "lead.email", label: "Lead email", example: "anita@example.com", category: "Lead" },
  { token: "lead.stage", label: "Lead stage", example: "Proposal Shared", category: "Lead" },
  { token: "lead.source", label: "Lead source", example: "Referral", category: "Lead" },

  // ── Family ────────────────────────────────────────────────────────────────
  { token: "family.family_name", label: "Family name", example: "Sharma Family", category: "Family" },
  { token: "family.head_name", label: "Family head", example: "Rajesh Sharma", category: "Family" },

  // ── Transaction / SIP ─────────────────────────────────────────────────────
  { token: "transaction.scheme_name", label: "Scheme name", example: "ICICI Bluechip Fund", category: "Transaction" },
  { token: "transaction.amount", label: "Amount", example: "10,000", category: "Transaction" },
  { token: "transaction.type", label: "Transaction type", example: "SIP", category: "Transaction" },
  { token: "transaction.transaction_date", label: "Transaction date", example: "15 Jun 2026", category: "Transaction" },
  { token: "transaction.folio_number", label: "Folio number", example: "12345678/00", category: "Transaction" },
  { token: "transaction.rejection_reason", label: "Rejection reason", example: "Insufficient balance", category: "Transaction" },

  // ── Tenant (MFD firm) ─────────────────────────────────────────────────────
  { token: "tenant.legalName", label: "Legal name", example: "Demo Wealth Advisors LLP", category: "Firm" },
  { token: "tenant.displayName", label: "Brand name", example: "Demo Wealth", category: "Firm" },
  { token: "tenant.arn", label: "ARN", example: "ARN-123456", category: "Firm" },
  { token: "tenant.principalEuin", label: "Principal EUIN", example: "E123456", category: "Firm" },
  { token: "tenant.address", label: "Office address", example: "B-205, Andheri East, Mumbai 400069", category: "Firm" },
  { token: "tenant.websiteUrl", label: "Website URL", example: "https://demowealth.in", category: "Firm" },

  // ── System ────────────────────────────────────────────────────────────────
  { token: "system.today", label: "Today's date", example: "15 Jun 2026", category: "System" },
  { token: "system.dashboard_url", label: "Client portal link", example: "https://...", category: "System" },
  { token: "system.unsubscribe_url", label: "Unsubscribe link", example: "https://...", category: "System" },
];

export function mergeFieldsByCategory(): Record<string, MergeField[]> {
  const out: Record<string, MergeField[]> = {};
  for (const f of MERGE_FIELDS) {
    (out[f.category] ??= []).push(f);
  }
  return out;
}
