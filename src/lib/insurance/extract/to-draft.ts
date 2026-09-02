/**
 * Step 7 (final): map the sanitized, entity-separated StructuredExtraction onto
 * the form's existing `InsuranceExtraction` draft shape — so the redesigned
 * pipeline is a drop-in replacement that the current new-policy form consumes
 * unchanged. Auto-fill confidence is carried through per field.
 *
 * Auto-fill policy (matches the spec):
 *   conf ≥ 0.90 → trusted auto-fill
 *   0.70–0.89   → filled but flagged for review (low fieldConfidence)
 *   < 0.70      → already dropped to null upstream (never guessed)
 */

import type { InsuranceExtraction, InsuranceCategory } from "@/lib/ai/assistant";
import { POLICY_TYPES, PREMIUM_FREQUENCIES } from "@/db/schema";
import type { Field, StructuredExtraction, TableRow } from "./types";

const v = <T>(f?: Field<T>): T | null => (f && f.value != null ? f.value : null);

/** Map a free-text policy type onto the closest enum, else null. */
function toPolicyType(s: string | null, kind: string): (typeof POLICY_TYPES)[number] | null {
  if (s) {
    const norm = s.toLowerCase().replace(/[^a-z]/g, "");
    const hit = (POLICY_TYPES as readonly string[]).find((t) => norm.includes(t.replace(/_/g, "")) || t.replace(/_/g, "").includes(norm));
    if (hit) return hit as (typeof POLICY_TYPES)[number];
    if (/term/.test(norm)) return "term" as any;
    if (/health|mediclaim/.test(norm)) return "health" as any;
    if (/motor|vehicle|car|bike/.test(norm)) return "motor" as any;
    if (/travel/.test(norm)) return "travel" as any;
  }
  const byKind: Record<string, string> = { life: "life_other", health: "health", motor: "motor", travel: "travel" };
  return (byKind[kind] as any) ?? null;
}
function toFreq(s: string | null): (typeof PREMIUM_FREQUENCIES)[number] | null {
  if (!s) return null;
  const n = s.toLowerCase();
  const hit = (PREMIUM_FREQUENCIES as readonly string[]).find((f) => n.includes(f.toLowerCase()));
  return (hit as any) ?? (/annual|yearly/.test(n) ? ("annual" as any) : /month/.test(n) ? ("monthly" as any) : /quarter/.test(n) ? ("quarterly" as any) : /half|semi/.test(n) ? ("half_yearly" as any) : /single|one/.test(n) ? ("single" as any) : null);
}
function toBiz(s: string | null): "new" | "renewal" | "portability" | null {
  if (!s) return null;
  const n = s.toLowerCase();
  return /renew/.test(n) ? "renewal" : /port/.test(n) ? "portability" : /new|fresh/.test(n) ? "new" : null;
}

const mapRows = (rows: TableRow[], map: Record<string, string>): TableRow[] =>
  rows.map((r) => {
    const out: TableRow = {};
    for (const [from, to] of Object.entries(map)) out[to] = (r[from] ?? null) as string | null;
    return out;
  });

export function structuredToDraft(x: StructuredExtraction): InsuranceExtraction {
  const p = x.policy, ph = x.policyholder, pr = x.proposer, ag = x.agency, rc = x.receipt, ps = x.premiumSummary;
  const policyType = toPolicyType(v(p.policyType), x.documentKind);
  const category: InsuranceCategory | null =
    x.documentKind === "life" ? "life" : x.documentKind === "health" ? "health" : x.documentKind === "motor" ? "motor" : ["travel", "general", "policy_schedule"].includes(x.documentKind) ? "general" : null;

  const details: Record<string, unknown> = {
    // Policyholder
    holderName: v(ph.name), customerId: v(ph.customerId), uin: v(ph.uin),
    email: v(ph.email), mobile: v(ph.mobile),
    addressLine1: v(ph.address), city: v(ph.city), state: v(ph.state), postalCode: v(ph.postalCode), country: v(ph.country) ?? "India",
    // Proposer
    proposerStatus: v(pr.status), proposerCustomerId: v(pr.customerId), proposerPhone: v(pr.phone), proposerEmail: v(pr.email),
    proposerAddressLine1: v(pr.address), proposerCity: v(pr.city), proposerState: v(pr.state), proposerPostalCode: v(pr.postalCode), proposerCountry: v(pr.country),
    proposerRemarks: v(pr.remarks),
    // Agency / agent (emit both legacy + new keys so whichever the form reads is filled)
    agencyCode: v(ag.agencyCode), agencyName: v(ag.agencyName), agentName: v(ag.agentName),
    agencyEmail: v(ag.agentEmail), agentEmail: v(ag.agentEmail), agencyContact: v(ag.agentPhone), agentPhone: v(ag.agentPhone),
    // Receipt
    receiptNo: v(rc.receiptNumber), receiptDate: v(rc.receiptDate), businessChannel: v(rc.businessChannel),
    taxInvoiceNo: v(rc.taxInvoiceNumber), taxInvoiceDate: v(rc.taxInvoiceDate), gstin: v(rc.gstin), receiptPan: v(rc.pan),
    paymentDetails: v(rc.paymentDetails),
    // Premium summary + commission
    financialYear: v(ps.financialYear), eightyDAmount: v(ps.eightyDAmount), grossPremium: v(ps.grossPremium),
    commission: v(p.commission), nomineeSharePercent: v(x.nominee.sharePercent),
    // Tables — mapped to the form's expected row-key names
    insuredMembers: mapRows(x.insuredMembers, { name: "name", customerId: "customerId", plan: "planOpted", subPlan: "subPlanOpted", gender: "gender", dob: "dob", age: "age", relation: "relation", firstInceptionDate: "firstInceptionDate", insuredAddress: "insuredAddress", nomineeRelation: "nominee" }),
    sumInsuredCovers: mapRows(x.sumInsured, { member: "memberName", cover: "cover", sumInsured: "sumInsured", cb: "cb", cbAmount: "cbAmount", limit: "limit", notes: "notes" }),
    // Optional covers is a member-row × dynamic-cover-column matrix — pass the
    // rows through as-is (already cleaned) so the per-cover keys survive.
    optionalCovers: (x.optionalCovers ?? []) as TableRow[],
    premiumBreakdown: mapRows(x.premiumDetails, { description: "description", amount: "amount" }),
    exclusions: mapRows(x.exclusions, { member: "memberName", exclusion: "exclusion" }),
  };
  // Drop null detail scalars so they don't overwrite anything the RM already typed.
  for (const k of Object.keys(details)) if (details[k] == null) delete details[k];

  // Per-field confidence for the form's review highlighting.
  const fc: Record<string, number> = {};
  const put = (key: string, f?: Field<any>) => { if (f && f.value != null) fc[key] = f.confidence; };
  put("insurer", p.insurer); put("planName", p.planName); put("policyNumber", p.policyNumber);
  put("sumAssured", p.sumAssured); put("annualPremium", p.annualPremium); put("policyStartDate", p.policyStartDate);
  put("maturityDate", p.maturityDate); put("nextPremiumDueDate", p.renewalDate);
  put("holderName", ph.name); put("email", ph.email); put("mobile", ph.mobile); put("addressLine1", ph.address);
  put("proposerName", pr.name); put("proposerPan", pr.pan); put("proposerEmail", pr.email); put("proposerPhone", pr.phone);
  put("agencyEmail", ag.agentEmail); put("agencyContact", ag.agentPhone); put("gstin", rc.gstin); put("nomineeName", x.nominee.name);

  return {
    insurer: v(p.insurer), planName: v(p.planName), policyNumber: v(p.policyNumber),
    policyType, category,
    sumAssured: v(p.sumAssured), annualPremium: v(p.annualPremium),
    premiumFrequency: toFreq(v(p.premiumFrequency)),
    premiumPayingTermYears: v(p.premiumPayingTermYears), policyTermYears: v(p.policyTermYears),
    policyStartDate: v(p.policyStartDate), maturityDate: v(p.maturityDate), nextPremiumDueDate: v(p.renewalDate),
    livesCovered: x.insuredMembers.length || null,
    nomineeName: v(x.nominee.name), nomineeRelation: v(x.nominee.relation),
    businessType: toBiz(v(p.businessType)),
    proposerName: v(pr.name), proposerPan: v(pr.pan),
    details,
    fieldConfidence: fc,
    overallConfidence: x.overallConfidence,
    warnings: x.warnings,
  };
}
