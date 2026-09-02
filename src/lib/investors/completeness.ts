/**
 * Client profile completeness — a 0-100 "how filled-in is this record" score and
 * the list of what's still missing. Distinct from the health score (which is
 * about engagement/compliance hygiene); this is purely "did we capture the data".
 *
 * Pure + tolerant of shape: reads both camelCase (Drizzle row) and snake_case
 * (raw SQL row) keys, so the same function serves the detail page and the list.
 */

type AnyRow = Record<string, any>;

function pick(inv: AnyRow, ...keys: string[]): any {
  for (const k of keys) {
    const v = inv?.[k];
    if (v !== undefined && v !== null) return v;
  }
  return null;
}
function nonEmpty(v: any): boolean {
  if (v == null) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

export type CompletenessField = { key: string; label: string; filled: boolean };
export type Completeness = {
  score: number; // 0-100
  filled: number;
  total: number;
  missing: CompletenessField[];
};

/** The fields that make a client record "complete", each weighted equally. */
export function clientCompleteness(inv: AnyRow): Completeness {
  const addr = pick(inv, "address");
  const addrFilled =
    !!addr && (nonEmpty(addr.line1) || nonEmpty(addr.city)) && nonEmpty(addr.pincode);
  const kyc = String(pick(inv, "kycStatus", "kyc_status") ?? "");
  const panAadhaar = String(pick(inv, "panAadhaarLinkStatus", "pan_aadhaar_link_status") ?? "");

  const checks: CompletenessField[] = [
    { key: "name", label: "Name", filled: nonEmpty(pick(inv, "name")) },
    { key: "pan", label: "PAN", filled: nonEmpty(pick(inv, "pan")) },
    { key: "dob", label: "Date of birth", filled: nonEmpty(pick(inv, "dob")) },
    { key: "gender", label: "Gender", filled: nonEmpty(pick(inv, "gender")) },
    { key: "email", label: "Email", filled: nonEmpty(pick(inv, "email")) },
    { key: "phone", label: "Mobile", filled: nonEmpty(pick(inv, "phone")) },
    { key: "address", label: "Address", filled: addrFilled },
    { key: "occupation", label: "Occupation", filled: nonEmpty(pick(inv, "occupation")) },
    { key: "kyc", label: "KYC verified", filled: kyc === "verified" || kyc === "registered" },
    { key: "pan_aadhaar", label: "PAN–Aadhaar linked", filled: panAadhaar === "linked" || panAadhaar === "not_applicable" },
    { key: "risk_profile", label: "Risk profile", filled: nonEmpty(pick(inv, "riskProfile", "risk_profile")) },
    { key: "nominee", label: "Nominee", filled: nonEmpty(pick(inv, "nominees")) || nonEmpty(pick(inv, "nomineeName", "nominee_name")) },
    { key: "bank", label: "Bank account", filled: nonEmpty(pick(inv, "bankAccounts", "bank_accounts")) || nonEmpty(pick(inv, "bankName", "bank_name")) },
    { key: "rm", label: "Assigned RM", filled: nonEmpty(pick(inv, "rmId", "rm_id")) },
    { key: "segment", label: "Segment / category", filled: nonEmpty(pick(inv, "segmentTag", "segment_tag")) || nonEmpty(pick(inv, "clientCategory", "client_category")) },
  ];

  const filled = checks.filter((c) => c.filled).length;
  const total = checks.length;
  return {
    score: Math.round((filled / total) * 100),
    filled,
    total,
    missing: checks.filter((c) => !c.filled),
  };
}

/** Tailwind tone for a completeness score. */
export function completenessTone(score: number): { text: string; ring: string; label: string } {
  if (score >= 90) return { text: "text-emerald-600", ring: "text-emerald-500", label: "Complete" };
  if (score >= 70) return { text: "text-amber-600", ring: "text-amber-500", label: "Mostly there" };
  return { text: "text-rose-600", ring: "text-rose-500", label: "Incomplete" };
}
