/**
 * Steps 4-6: classification. The model reads the document NATIVELY (multimodal,
 * no OCR loss) AND receives the regex candidate lists, then ASSIGNS each value
 * to the correct entity — policy / policyholder / proposer / nominee / agent /
 * agency / receipt — keeping them strictly separate, extracts the dynamic
 * tables independently, and returns value+confidence+source+page per field.
 *
 * It classifies; it does not invent. For emails/phones/PAN/GST/PIN/dates the
 * allowed values are exactly the candidates passed in.
 */

import { aiMessagesClient } from "@/lib/ai/provider";
import type { Candidates, StructuredExtraction } from "./types";

const FIELD = `{ "value": <string|number|null>, "confidence": <0..1>, "source": <string label where you found it, or null>, "page": <1-based page number or null> }`;

function candidateBlock(c: Candidates): string {
  const fmt = (a: { value: string; page: number }[]) =>
    a.length ? a.map((x) => `${x.value} (p${x.page})`).join("; ") : "(none found)";
  return [
    `EMAILS: ${fmt(c.emails)}`,
    `PHONES: ${fmt(c.phones)}`,
    `PANs: ${fmt(c.pans)}`,
    `GSTINs: ${fmt(c.gstins)}`,
    `UINs: ${fmt(c.uins)}`,
    `PIN CODES: ${fmt(c.pinCodes)}`,
    `POLICY NUMBERS (label-anchored): ${fmt(c.policyNumbers)}`,
    `CUSTOMER IDS (label-anchored): ${fmt(c.customerIds)}`,
    `DATES: ${fmt(c.dates)}`,
    `AMOUNTS: ${fmt(c.amounts)}`,
  ].join("\n");
}

const SYSTEM = `You are a precise insurance-document understanding engine for an Indian MFD's CRM.
You are given an insurance document (Life / Health / Motor / Travel / Policy Schedule) NATIVELY, plus
lists of CANDIDATE values that were already extracted from it by regex. Your job is to CLASSIFY — assign
each value to the correct entity. Do NOT discover values freely; for emails, phones, PAN, GSTIN, PIN codes
and dates, you may ONLY use values from the candidate lists (or null).

ENTITY SEPARATION — these are different parties; NEVER copy a value from one to another:
- policyholder / insured: the customer who owns the policy.
- proposer: the person who bought it (often the same as the holder; fill proposer only when it differs or is its own labelled block).
- nominee: the beneficiary.
- agent / agency: the intermediary/advisor and their firm.
- receipt: payment/tax-invoice details.
- insurer: the insurance COMPANY (its branch/corporate/grievance contacts are NOT the customer's).

DISAMBIGUATION RULES (critical — these are the mistakes to avoid):
- Customer email = the email in the policyholder/proposer block. The AGENT email sits under "Agent / Advisor / Intermediary".
  IGNORE and never assign support@/care@/noreply@/grievance@/info@/customerservice@ style addresses to any person.
- Customer mobile = the 10-digit number in the holder/proposer block. A 1800/1860 toll-free or "customer care"/"helpline"
  number is the INSURER's — never the customer's phone.
- Customer address = the "Address / Communication Address / Correspondence Address" of the holder. A
  "Branch / Registered Office / Corporate Office" address belongs to the insurer — ignore it.
- PAN: the proposer's PAN sits by their name; a PAN embedded in a GSTIN is the insurer/agency's — do not use it as the proposer PAN.
- Policy number: prefer the value next to "Policy No / Certificate No"; reject anything with stray OCR symbols.

TABLES — extract each INDEPENDENTLY, one object per row, copy values EXACTLY as printed, never merge rows or columns.
Each table cell is a PLAIN STRING (e.g. "John Doe"), NOT a {value,confidence,...} object — the confidence object format applies ONLY to the scalar entity fields below, never to table cells:
- insuredMembers: [{ name, customerId, plan, subPlan, gender, dob (yyyy-mm-dd), age, relation, firstInceptionDate (yyyy-mm-dd, the member's first/original policy inception date), insuredAddress, nomineeRelation }]
- sumInsured: emit ONE ROW PER INSURED MEMBER (not one combined row): [{ member, cover, sumInsured, cb (cumulative bonus % or units), cbAmount (cumulative-bonus amount in ₹), limit, notes }]
- optionalCovers: a MATRIX — emit ONE ROW PER INSURED MEMBER. Each row has the member's name under "member" PLUS one key per optional cover, using the cover's PRINTED name as the key and that member's sum insured as the value. Example for a 3-member health policy:
    [ { "member": "Harshad V Ashar", "Loss of Income (per week)": "0", "Major Illness & Accident Multiplier": "2000000", "International Cover - Emergency Care": "0" },
      { "member": "Neha Ashar", "Loss of Income (per week)": "0", "Major Illness & Accident Multiplier": "2000000", "International Cover - Emergency Care": "0" } ]
  Use the SAME cover keys across every member row. If a cover applies to all members with one shared value, repeat that value on each member's row.
- premiumDetails: [{ description, amount }]
- exclusions:     [{ member, exclusion }]

CONFIDENCE: 1.0 explicitly labelled · 0.95 clearly associated with the entity · 0.85 strong contextual evidence ·
below 0.70 → set value to null (do not guess). Every scalar field is the object ${FIELD}.

OUTPUT — a SINGLE JSON object, no markdown, exactly this shape (omit nothing; use null fields when absent):
{
 "documentKind": "life|health|motor|travel|general|policy_schedule|unknown",
 "policy": { "insurer":F, "planName":F, "policyNumber":F, "policyType":F, "businessType":F, "sumAssured":F, "annualPremium":F, "premiumFrequency":F, "commission":F, "policyStartDate":F, "policyTermYears":F, "premiumPayingTermYears":F, "maturityDate":F, "renewalDate":F },
 "policyholder": { "name":F, "customerId":F, "uin":F, "email":F, "mobile":F, "address":F, "city":F, "state":F, "postalCode":F, "country":F },
 "proposer": { "name":F, "pan":F, "status":F, "customerId":F, "phone":F, "email":F, "address":F, "city":F, "state":F, "postalCode":F, "country":F, "remarks":F },
 "nominee": { "name":F, "relation":F, "sharePercent":F },
 "agency": { "agencyCode":F, "agencyName":F, "agentName":F, "agentEmail":F, "agentPhone":F },
 "receipt": { "receiptNumber":F, "receiptDate":F, "businessChannel":F, "taxInvoiceNumber":F, "taxInvoiceDate":F, "gstin":F, "pan":F, "paymentDetails":F },
 "premiumSummary": { "grossPremium":F, "financialYear":F, "eightyDAmount":F },
 "insuredMembers": [], "sumInsured": [], "optionalCovers": [], "premiumDetails": [], "exclusions": [],
 "overallConfidence": <0..1>, "warnings": [ "short notes about anything ambiguous" ]
}
where F is the object ${FIELD}. Dates as yyyy-mm-dd. Money as a number (digits only). Output ONLY the JSON.`;

export async function classifyDocument(input: {
  base64: string;
  mediaType: "application/pdf" | "image/jpeg" | "image/png";
  candidates: Candidates;
  fullText: string;
}): Promise<StructuredExtraction> {
  const docBlock =
    input.mediaType === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: input.base64 } }
      : { type: "image", source: { type: "base64", media_type: input.mediaType, data: input.base64 } };

  // The text excerpt anchors the model when the native render is ambiguous; cap
  // it so a huge policy book doesn't blow the context window.
  const excerpt = input.fullText.slice(0, 18000);

  const res = await aiMessagesClient().messages.create({
    model: "reasoning",
    max_tokens: 8000,
    system: SYSTEM,
    responseFormat: "json",
    messages: [
      {
        role: "user",
        content: [
          docBlock as any,
          {
            type: "text",
            text:
              `CANDIDATE VALUES (assign from these only, where the rule says so):\n${candidateBlock(input.candidates)}\n\n` +
              `EXTRACTED TEXT (for context):\n${excerpt}\n\n` +
              `Classify this document into the JSON schema. Keep entities separate. Return JSON only.`,
          },
        ],
      },
    ],
  });

  const text = res.content.filter((b) => b.type === "text").map((b: any) => b.text).join("\n").trim();
  const json = text.replace(/^```(?:json)?\n?/, "").replace(/```\s*$/, "").trim();
  return JSON.parse(json) as StructuredExtraction;
}
