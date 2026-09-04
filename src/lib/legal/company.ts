/**
 * Company / legal-entity details rendered on the public legal pages
 * (/terms, /privacy, /refund) and printed on GST invoices/receipts.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  ⚠️  ACTION REQUIRED BEFORE COMMERCIAL LAUNCH
 *  Replace every value marked `TODO` below with your REGISTERED legal-entity
 *  details, then have the resulting Terms / Privacy / Refund pages reviewed by
 *  a lawyer. The text on those pages is a professional starting point for an
 *  India-based B2B SaaS — it is NOT legal advice and must be reviewed before
 *  you rely on it commercially.
 * ─────────────────────────────────────────────────────────────────────────
 */
function configured(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

export const LEGAL = {
  /** Product / brand name shown to users. */
  brand: configured("LEGAL_BRAND_NAME", "Equitywala"),
  /** Registered legal entity that operates the platform. */
  legalEntity: configured("LEGAL_ENTITY_NAME", "Equitywala"),
  /** Registered office address (single line is fine). */
  address: configured("LEGAL_REGISTERED_ADDRESS", "India"),
  /** Public support / contact email. */
  email: configured("LEGAL_SUPPORT_EMAIL", "support@ssit.com"),
  /** Support / grievance phone (optional — leave "" to hide). */
  phone: configured("LEGAL_SUPPORT_PHONE", ""),
  /** GST registration number — printed on invoices. */
  gstin: configured("LEGAL_GSTIN", ""),
  /** CIN, if a company. */
  cin: configured("LEGAL_CIN", ""),
  /**
   * Grievance Officer — naming one is required under India's DPDP Act 2023
   * and the IT (Intermediary Guidelines) Rules. Use a real, monitored inbox.
   */
  grievanceOfficer: configured("LEGAL_GRIEVANCE_OFFICER", "Grievance Officer"),
  grievanceEmail: configured("LEGAL_GRIEVANCE_EMAIL", "grievance@ssit.com"),
  /** Governing-law city for dispute jurisdiction. */
  jurisdiction: configured("LEGAL_JURISDICTION", "Mumbai, Maharashtra, India"),
  /** Canonical product URL. */
  url: configured("LEGAL_PRODUCT_URL", "https://crm.equitywala.com"),
  /**
   * Shown as "Last updated" on each legal page. This is intentionally a fixed
   * string (not the render date): a legal document's effective date should
   * only change when you actually revise the text. Bump it when you edit.
   */
  lastUpdated: "14 June 2026",
} as const;

export function commercialLegalReadiness() {
  const checks = [
    { key: "entity", label: "Registered legal entity", ok: LEGAL.legalEntity !== "Equitywala" },
    { key: "address", label: "Registered office address", ok: LEGAL.address !== "India" && LEGAL.address.length >= 12 },
    { key: "support", label: "Support contact", ok: !!LEGAL.email && !!LEGAL.phone },
    { key: "gstin", label: "GSTIN", ok: /^[0-9A-Z]{15}$/.test(LEGAL.gstin) },
    { key: "grievance", label: "Named grievance officer", ok: LEGAL.grievanceOfficer !== "Grievance Officer" && !!LEGAL.grievanceEmail },
    { key: "jurisdiction", label: "Reviewed dispute jurisdiction", ok: !!LEGAL.jurisdiction },
  ];
  return { ready: checks.every((check) => check.ok), checks };
}

/**
 * Third-party sub-processors the platform relies on. Disclosed in the Privacy
 * Policy (DPDP transparency) and useful for a customer DPA. Keep in sync with
 * the adapters in src/lib/comms/adapters and the storage/billing config.
 */
export const SUBPROCESSORS: ReadonlyArray<{ name: string; purpose: string; region: string }> = [
  { name: "Amazon Web Services (AWS)", purpose: "Application hosting, database & encrypted file storage", region: "Mumbai (ap-south-1), India" },
  { name: "Razorpay", purpose: "Subscription billing & payment processing", region: "India" },
  { name: "Resend", purpose: "Transactional & campaign email delivery", region: "United States / EU" },
  { name: "Vartify", purpose: "WhatsApp Business messaging (BSP)", region: "India" },
  { name: "MSG91", purpose: "DLT-compliant transactional SMS", region: "India" },
  { name: "Anthropic", purpose: "AI assistance (message drafting & classification)", region: "United States" },
] as const;
