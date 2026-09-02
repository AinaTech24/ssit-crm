/**
 * Step 7: orchestration. Ties detect → text → candidates → classify → validate
 * together and returns a sanitized StructuredExtraction. Every field the model
 * returns is independently re-validated (format check) and gated at 0.70 — the
 * model's confidence is necessary but not sufficient; the value must also be
 * well-formed. This is the "never auto-fill garbage" guarantee.
 */

import type { Field, StructuredExtraction } from "./types";
import { NF } from "./types";
import { extractDoc, stripBoilerplate } from "./text";
import { extractCandidates } from "./candidates";
import { classifyDocument } from "./classify";
import { isEmail, isPhone, isPan, isGstin, isPin, isCleanRef, toMoney, toIso } from "./validate";

const MIN_CONF = 0.7; // below this → drop (never guess)

type Validator = (v: string) => boolean;
type Transform = (v: any) => any;

/** Coerce a raw model value into a Field, then enforce a validator/transform. */
function field(raw: any, opts: { validate?: Validator; transform?: Transform; max?: number } = {}): Field<any> {
  if (!raw || typeof raw !== "object") return NF();
  let value = raw.value;
  let confidence = Math.max(0, Math.min(1, Number(raw.confidence) || 0));
  const source = raw.source ? String(raw.source).slice(0, 80) : null;
  const page = Number.isFinite(Number(raw.page)) ? Number(raw.page) : null;

  if (value == null || value === "") return { value: null, confidence: 0, source, page };
  if (opts.transform) value = opts.transform(value);
  if (value == null) return { value: null, confidence: 0, source, page };

  if (opts.validate && !opts.validate(String(value))) {
    return { value: null, confidence: 0, source, page }; // failed format check → drop
  }
  if (typeof value === "string" && opts.max) value = value.slice(0, opts.max);
  if (confidence < MIN_CONF) return { value: null, confidence, source, page }; // gate

  return { value, confidence, source, page };
}

const txtField = (raw: any, max = 200) => field(raw, { max });
const upper = (v: any) => (v == null ? null : String(v).trim().toUpperCase());

function sanitize(x: StructuredExtraction): StructuredExtraction {
  const moneyF = (r: any) => field(r, { transform: toMoney });
  const dateF = (r: any) => field(r, { transform: toIso, validate: () => true });
  const numF = (r: any) => field(r, { transform: (v) => (Number.isFinite(Number(String(v).replace(/[^\d.]/g, ""))) ? Number(String(v).replace(/[^\d.]/g, "")) : null) });

  return {
    documentKind: x.documentKind ?? "unknown",
    policy: {
      insurer: txtField(x.policy?.insurer, 120),
      planName: txtField(x.policy?.planName, 200),
      policyNumber: field(x.policy?.policyNumber, { validate: isCleanRef, max: 40 }),
      policyType: txtField(x.policy?.policyType, 40),
      businessType: txtField(x.policy?.businessType, 20),
      sumAssured: moneyF(x.policy?.sumAssured),
      annualPremium: moneyF(x.policy?.annualPremium),
      premiumFrequency: txtField(x.policy?.premiumFrequency, 20),
      commission: moneyF(x.policy?.commission),
      policyStartDate: dateF(x.policy?.policyStartDate),
      policyTermYears: numF(x.policy?.policyTermYears),
      premiumPayingTermYears: numF(x.policy?.premiumPayingTermYears),
      maturityDate: dateF(x.policy?.maturityDate),
      renewalDate: dateF(x.policy?.renewalDate),
    },
    policyholder: {
      name: txtField(x.policyholder?.name, 120),
      customerId: txtField(x.policyholder?.customerId, 40),
      uin: txtField(x.policyholder?.uin, 40),
      email: field(x.policyholder?.email, { validate: isEmail, transform: (v) => String(v).trim().toLowerCase() }),
      mobile: field(x.policyholder?.mobile, { validate: isPhone }),
      address: txtField(x.policyholder?.address, 300),
      city: txtField(x.policyholder?.city, 80),
      state: txtField(x.policyholder?.state, 80),
      postalCode: field(x.policyholder?.postalCode, { validate: isPin }),
      country: txtField(x.policyholder?.country, 60),
    },
    proposer: {
      name: txtField(x.proposer?.name, 120),
      pan: field(x.proposer?.pan, { validate: isPan, transform: upper }),
      status: txtField(x.proposer?.status, 40),
      customerId: txtField(x.proposer?.customerId, 40),
      phone: field(x.proposer?.phone, { validate: isPhone }),
      email: field(x.proposer?.email, { validate: isEmail, transform: (v) => String(v).trim().toLowerCase() }),
      address: txtField(x.proposer?.address, 300),
      city: txtField(x.proposer?.city, 80),
      state: txtField(x.proposer?.state, 80),
      postalCode: field(x.proposer?.postalCode, { validate: isPin }),
      country: txtField(x.proposer?.country, 60),
      remarks: txtField(x.proposer?.remarks, 300),
    },
    nominee: {
      name: txtField(x.nominee?.name, 120),
      relation: txtField(x.nominee?.relation, 40),
      sharePercent: numF(x.nominee?.sharePercent),
    },
    agency: {
      agencyCode: txtField(x.agency?.agencyCode, 40),
      agencyName: txtField(x.agency?.agencyName, 120),
      agentName: txtField(x.agency?.agentName, 120),
      agentEmail: field(x.agency?.agentEmail, { validate: isEmail, transform: (v) => String(v).trim().toLowerCase() }),
      agentPhone: field(x.agency?.agentPhone, { validate: isPhone }),
    },
    receipt: {
      receiptNumber: field(x.receipt?.receiptNumber, { validate: isCleanRef, max: 40 }),
      receiptDate: dateF(x.receipt?.receiptDate),
      businessChannel: txtField(x.receipt?.businessChannel, 60),
      taxInvoiceNumber: txtField(x.receipt?.taxInvoiceNumber, 40),
      taxInvoiceDate: dateF(x.receipt?.taxInvoiceDate),
      gstin: field(x.receipt?.gstin, { validate: isGstin, transform: upper }),
      pan: field(x.receipt?.pan, { validate: isPan, transform: upper }),
      paymentDetails: txtField(x.receipt?.paymentDetails, 200),
    },
    premiumSummary: {
      grossPremium: moneyF(x.premiumSummary?.grossPremium),
      financialYear: txtField(x.premiumSummary?.financialYear, 20),
      eightyDAmount: moneyF(x.premiumSummary?.eightyDAmount),
    },
    insuredMembers: cleanRows(x.insuredMembers),
    sumInsured: cleanRows(x.sumInsured),
    optionalCovers: cleanRows(x.optionalCovers),
    premiumDetails: cleanRows(x.premiumDetails),
    exclusions: cleanRows(x.exclusions),
    overallConfidence: Math.max(0, Math.min(1, Number(x.overallConfidence) || 0)),
    warnings: Array.isArray(x.warnings) ? x.warnings.map(String).slice(0, 10) : [],
  };
}

function cleanRows(rows: any): Record<string, string | null>[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r) => r && typeof r === "object")
    .map((r) => {
      const out: Record<string, string | null> = {};
      for (const [k, v] of Object.entries(r)) out[k] = cellToString(v);
      return out;
    })
    .filter((r) => Object.values(r).some((v) => v && v.trim()))
    .slice(0, 50);
}

/**
 * Coerce a table cell to a string. The model sometimes wraps a cell as a Field
 * object ({ value, confidence, ... }) — unwrap it so the UI shows the real value
 * instead of "[object Object]". Also handles plain objects/arrays gracefully.
 */
function cellToString(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("value" in o) return o.value == null ? null : String(o.value).slice(0, 200);
    if (Array.isArray(v)) return v.map((x) => cellToString(x)).filter(Boolean).join(", ").slice(0, 200) || null;
    // Last resort: a small object → "k: v" pairs, never "[object Object]".
    const pairs = Object.entries(o).filter(([, val]) => val != null && typeof val !== "object").map(([k, val]) => `${k}: ${val}`);
    return pairs.length ? pairs.join(", ").slice(0, 200) : null;
  }
  return String(v).slice(0, 200);
}

export type PipelineResult = {
  structured: StructuredExtraction;
  meta: { docKind: string; pageCount: number; candidateCounts: Record<string, number> };
};

export async function runExtractionPipeline(
  buffer: Buffer,
  mediaType: "application/pdf" | "image/jpeg" | "image/png"
): Promise<PipelineResult> {
  const doc = await extractDoc(buffer, mediaType); // steps 1-2
  const pages = stripBoilerplate(doc.pages);
  const candidates = extractCandidates(pages); // step 3

  // Step 4-6 — classify, with one structural retry if the JSON is malformed
  // (the provider layer already retries transient network/overload errors).
  let structured: StructuredExtraction;
  try {
    structured = await classifyDocument({ base64: buffer.toString("base64"), mediaType, candidates, fullText: doc.fullText });
  } catch (e: any) {
    if (e instanceof SyntaxError) {
      structured = await classifyDocument({ base64: buffer.toString("base64"), mediaType, candidates, fullText: doc.fullText });
    } else {
      throw e;
    }
  }

  return {
    structured: sanitize(structured), // step 7 — validate + gate
    meta: {
      docKind: doc.kind,
      pageCount: doc.pageCount,
      candidateCounts: Object.fromEntries(Object.entries(candidates).map(([k, v]) => [k, (v as any[]).length])),
    },
  };
}
