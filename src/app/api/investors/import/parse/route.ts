import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/investors/import/parse
 * multipart/form-data: file=<xlsx|csv>
 *
 * Parses the uploaded file in memory and returns:
 *   { headers: string[], rows: object[], suggestedMapping: Record<headerKey, ourField> }
 *
 * Does NOT touch the DB — that's the commit step.
 */

import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { and, asc, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { customFieldDefs } from "@/db/schema";

export const dynamic = "force-dynamic";

// Every field the add-investor form captures — so an Excel import can populate
// the full client master, not just the basics. Each has a HUMAN label (shown in
// the column-mapping dropdown, matching the add-investor form wording) and a
// group (renders as an <optgroup> so 50+ fields stay scannable). `key` is the
// internal field name the commit step writes.
type FieldDef = { key: string; label: string; group: string };
const FIELD_DEFS: FieldDef[] = [
  // Identity & personal
  { key: "name", label: "Full Name", group: "Identity" },
  // The platform's own record id — only relevant for re-imports / updates, where
  // the user matches existing clients on "Client ID" (see the import "Update
  // existing" / "Both" modes). Harmless to map on a fresh add import.
  { key: "clientId", label: "Client ID (existing record id)", group: "Identity" },
  { key: "pan", label: "PAN", group: "Identity" },
  { key: "nameAsPerPan", label: "Name as per PAN", group: "Identity" },
  { key: "dob", label: "Date of Birth", group: "Identity" },
  { key: "gender", label: "Gender", group: "Identity" },
  { key: "birthPlace", label: "Birth Place", group: "Identity" },
  { key: "motherName", label: "Mother's Name", group: "Identity" },
  { key: "maritalStatus", label: "Marital Status", group: "Identity" },
  { key: "occupation", label: "Occupation", group: "Identity" },
  { key: "employerName", label: "Employer Name", group: "Identity" },
  { key: "aadhaarLast4", label: "Aadhaar (last 4 digits)", group: "Identity" },
  // Contact
  { key: "email", label: "Email", group: "Contact" },
  { key: "emailRelation", label: "Email belongs to", group: "Contact" },
  { key: "phone", label: "Mobile Number", group: "Contact" },
  { key: "mobileRelation", label: "Mobile belongs to", group: "Contact" },
  { key: "whatsappPhone", label: "WhatsApp Number", group: "Contact" },
  // Mailing address
  { key: "addressLine1", label: "Street Address", group: "Address" },
  { key: "city", label: "City", group: "Address" },
  { key: "state", label: "State", group: "Address" },
  { key: "pincode", label: "Pincode", group: "Address" },
  { key: "country", label: "Country", group: "Address" },
  // Classification
  { key: "investorCategory", label: "Investor Category (entity type)", group: "Classification" },
  { key: "segmentTag", label: "Segment", group: "Classification" },
  { key: "clientCategory", label: "Client Category (A–D)", group: "Classification" },
  { key: "status", label: "Client Status (active/dormant/inactive/redemption_risk/closed)", group: "Classification" },
  { key: "riskProfile", label: "Risk Profile (conservative/moderate/aggressive/very_aggressive)", group: "Classification" },
  { key: "householdType", label: "Family or Individual (household type)", group: "Classification" },
  { key: "familyOwnerName", label: "Family Head Name", group: "Classification" },
  { key: "referralClientName", label: "Referral Client Name", group: "Classification" },
  { key: "modeOfHolding", label: "Mode of Holding", group: "Classification" },
  { key: "bseUccCode", label: "BSE UCC Code", group: "Classification" },
  { key: "nseCanCode", label: "NSE CAN Code", group: "Classification" },
  { key: "uccCodes", label: "Other UCC codes (comma-separated)", group: "Classification" },
  // Compliance
  { key: "taxStatus", label: "Tax Status", group: "Compliance" },
  { key: "residencyStatus", label: "Residential Status", group: "Compliance" },
  { key: "kycStatus", label: "KYC Status", group: "Compliance" },
  // Second / joint holder
  { key: "secondHolderFirstName", label: "2nd Holder — First Name", group: "Second Holder" },
  { key: "secondHolderLastName", label: "2nd Holder — Last Name", group: "Second Holder" },
  { key: "secondHolderOccupation", label: "2nd Holder — Occupation", group: "Second Holder" },
  { key: "secondHolderCompanyName", label: "2nd Holder — Company", group: "Second Holder" },
  { key: "secondHolderBirthPlace", label: "2nd Holder — Birth Place", group: "Second Holder" },
  { key: "secondHolderMotherName", label: "2nd Holder — Mother's Name", group: "Second Holder" },
  { key: "secondHolderMaritalStatus", label: "2nd Holder — Marital Status", group: "Second Holder" },
  // Relationship & review
  { key: "rmId", label: "Assigned RM (name or email)", group: "Relationship & Review" },
  { key: "aum", label: "AUM (current value, ₹)", group: "Relationship & Review" },
  { key: "onboardedAt", label: "Onboarded Date", group: "Relationship & Review" },
  { key: "anniversaryDate", label: "Anniversary Date", group: "Relationship & Review" },
  { key: "lastReviewAt", label: "Last Meeting Date", group: "Relationship & Review" },
  { key: "nextReviewAt", label: "Next Meeting Date", group: "Relationship & Review" },
  { key: "reviewFrequency", label: "Review Frequency", group: "Relationship & Review" },
  // Nominee & bank
  { key: "nomineeName", label: "Nominee Name", group: "Nominee & Bank" },
  { key: "nomineeRelation", label: "Nominee Relation", group: "Nominee & Bank" },
  { key: "nomineeDob", label: "Nominee Date of Birth", group: "Nominee & Bank" },
  { key: "bankName", label: "Bank Name", group: "Nominee & Bank" },
  { key: "bankAccountNumberMasked", label: "Bank Account Number", group: "Nominee & Bank" },
  { key: "bankIfsc", label: "Bank IFSC", group: "Nominee & Bank" },
  // Everything else the importer can write. A migrated book arrives with far
  // more than the headline columns — distributor codes, mandate details, CKYC,
  // the running SIP/inflow figures — and anything not offered here had to be
  // re-entered by hand afterwards.
  { key: "alternatePhone", label: "Alternate Phone", group: "Contact" },
  { key: "familyRole", label: "Family Role (head/spouse/child)", group: "Contact" },
  { key: "incomeRange", label: "Income Range", group: "Contact" },
  { key: "languagePref", label: "Preferred Language", group: "Contact" },
  { key: "mfCode", label: "MF Code", group: "Codes & Distributor" },
  { key: "moCode", label: "MO Code", group: "Codes & Distributor" },
  { key: "bajajCode", label: "Bajaj Code", group: "Codes & Distributor" },
  { key: "lasCode", label: "LAS Code", group: "Codes & Distributor" },
  { key: "relationshipCategory", label: "Relationship Category", group: "Relationship & Review" },
  { key: "serviceTier", label: "Service Tier (A/B/C)", group: "Relationship & Review" },
  { key: "statementCadence", label: "Statement Cadence", group: "Relationship & Review" },
  { key: "ckycNumber", label: "CKYC Number", group: "KYC & Compliance" },
  { key: "kraName", label: "KRA Name", group: "KYC & Compliance" },
  { key: "fatcaStatus", label: "FATCA Status", group: "KYC & Compliance" },
  { key: "panAadhaarLinkStatus", label: "PAN–Aadhaar Link Status", group: "KYC & Compliance" },
  { key: "mandateStatus", label: "Mandate Status", group: "Mandate" },
  { key: "mandateRefNo", label: "Mandate Reference No", group: "Mandate" },
  { key: "mandateAmount", label: "Mandate Amount (₹)", group: "Mandate" },
  { key: "activeSipAmount", label: "Active SIP Amount (₹/month)", group: "Relationship & Review" },
  { key: "lifetimeInflow", label: "Lifetime Inflow (₹)", group: "Relationship & Review" },
  { key: "lifetimeOutflow", label: "Lifetime Outflow (₹)", group: "Relationship & Review" },
  { key: "ckycExpiryAt", label: "CKYC Expiry Date", group: "KYC & Compliance" },
  // Notes
  { key: "notes", label: "Notes", group: "Notes" },
];

/** Heuristic header → field guesser. */
function suggestMapping(headers: string[]): Record<string, string> {
  const m: Record<string, string> = {};
  // Order matters — more specific patterns first so e.g. "Tax Status" matches
  // taxStatus before a generic "status" rule could grab it.
  const patterns: Array<[RegExp, string]> = [
    [/name.?as.?per.?pan|pan.?name/i, "nameAsPerPan"],
    [/client.?id|record.?id|investor.?id|cust(omer)?.?id|contact.?id|^id$/i, "clientId"],
    [/^pan|pan.?card|pan.?no/i, "pan"],
    [/whatsapp|wa.?no/i, "whatsappPhone"],
    [/^email|e.?mail/i, "email"],
    [/^phone$|mobile|contact.?no|^contact/i, "phone"],
    [/dob|date.?of.?birth|birth.?date/i, "dob"],
    [/gender|sex/i, "gender"],
    [/mother/i, "motherName"],
    [/marital/i, "maritalStatus"],
    [/occupation|profession/i, "occupation"],
    [/employer|company.?name/i, "employerName"],
    [/aadha?ar/i, "aadhaarLast4"],
    [/street|address|addr/i, "addressLine1"],
    [/^city|town/i, "city"],
    [/^state|province/i, "state"],
    [/pincode|pin.?code|zip|postal/i, "pincode"],
    [/country|nationality/i, "country"],
    [/tax.?status/i, "taxStatus"],
    [/residen|residency/i, "residencyStatus"],
    [/kyc/i, "kycStatus"],
    [/referr/i, "referralClientName"],
    [/family.?head|household.?head|family.?owner/i, "familyOwnerName"],
    [/household/i, "householdType"],
    [/holding.?mode|mode.?of.?holding/i, "modeOfHolding"],
    [/ucc/i, "bseUccCode"],
    [/can.?(code|no)|nse.?can/i, "nseCanCode"],
    [/segment/i, "segmentTag"],
    [/client.?cat|grade/i, "clientCategory"],
    [/entity.?type|investor.?cat|^category$|^type$/i, "investorCategory"],
    [/assigned.?rm|^rm$|relationship.?manager|advisor|servicing.?rm/i, "rmId"],
    [/^aum$|assets?.?under.?management|current.?value|portfolio.?value/i, "aum"],
    [/risk.?profile|risk.?category|^risk$|risk.?appetite/i, "riskProfile"],
    [/client.?status|account.?status|lifecycle.?status|^status$/i, "status"],
    [/review.?freq|frequency/i, "reviewFrequency"],
    [/last.?(meeting|review|contact)/i, "lastReviewAt"],
    [/next.?(meeting|review)/i, "nextReviewAt"],
    [/anniversary/i, "anniversaryDate"],
    [/onboard|join.?date|client.?since/i, "onboardedAt"],
    [/nominee.?rel/i, "nomineeRelation"],
    [/nominee.?dob|nominee.?birth/i, "nomineeDob"],
    [/nominee.?name|nominee$/i, "nomineeName"],
    [/bank.?name/i, "bankName"],
    [/account.?no|a\/c|bank.?ac|acct/i, "bankAccountNumberMasked"],
    [/ifsc/i, "bankIfsc"],
    [/^name|client.?name|investor.?name|full.?name|holder.?name|^holder|account.?holder|applicant|^investor$|^client$/i, "name"],
  ];
  for (const h of headers) {
    for (const [re, field] of patterns) {
      if (re.test(h)) {
        m[h] = field;
        break;
      }
    }
  }
  return m;
}

/** A value that reads like a person/entity name: has letters, no '@', not a
 *  phone/PAN/number/code. */
function looksLikeName(v: string): boolean {
  const s = String(v ?? "").trim();
  if (!s || s.includes("@")) return false;
  if (/\d/.test(s)) return false; // phones, PANs, codes all contain digits
  return /^[A-Za-z][A-Za-z .,'&()/-]{1,}$/.test(s);
}

/** Fraction of a column's sampled values that look like names (0–1). */
function nameColumnScore(rows: Record<string, any>[], header: string): number {
  let nameLike = 0;
  let total = 0;
  for (const row of rows.slice(0, 40)) {
    const v = String(row[header] ?? "").trim();
    if (!v) continue;
    total++;
    if (looksLikeName(v)) nameLike++;
  }
  return total === 0 ? 0 : nameLike / total;
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "file required" }, { status: 400 });
    }
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: "file too large (max 10MB)" }, { status: 413 });
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    if (!sheet) {
      return NextResponse.json({ error: "no sheet found" }, { status: 400 });
    }

    const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: "", raw: false });
    if (rows.length === 0) {
      return NextResponse.json({ error: "empty sheet" }, { status: 400 });
    }
    if (rows.length > 5000) {
      return NextResponse.json({ error: "too many rows (max 5000 per import)" }, { status: 413 });
    }

    const headers = Object.keys(rows[0]);
    const suggested = suggestMapping(headers);

    // Header-guessing misses oddly-named files (RTA/CAMS exports), leaving the
    // `name` field unmapped → it falls back to a phone number. Verify the
    // header-mapped name column actually holds names; if not, pick the most
    // name-like UNMAPPED column by sampling its values.
    const nameHeader = Object.keys(suggested).find((h) => suggested[h] === "name");
    const nameOk = nameHeader ? nameColumnScore(rows, nameHeader) >= 0.5 : false;
    if (!nameOk) {
      const excluded = new Set(Object.keys(suggested).filter((h) => h !== nameHeader));
      let best: string | null = null;
      let bestScore = 0;
      for (const h of headers) {
        if (excluded.has(h)) continue;
        const score = nameColumnScore(rows, h);
        if (score > bestScore) {
          bestScore = score;
          best = h;
        }
      }
      if (best && bestScore >= 0.6) {
        if (nameHeader && nameHeader !== best) delete suggested[nameHeader]; // drop the wrong guess
        suggested[best] = "name";
      }
    }

    // Append the firm's custom fields as a "Custom fields" group so they're
    // mappable alongside the built-in client-master fields.
    const cfDefs = await withTenant(session.tenantId, (tx) =>
      tx
        .select({ key: customFieldDefs.key, label: customFieldDefs.label })
        .from(customFieldDefs)
        .where(and(eq(customFieldDefs.tenantId, session.tenantId), eq(customFieldDefs.entity, "investor")))
        .orderBy(asc(customFieldDefs.sortOrder))
    );
    const ourFields: FieldDef[] = [
      ...FIELD_DEFS,
      ...cfDefs.map((d) => ({ key: d.key, label: d.label, group: "Custom fields" })),
    ];

    // Return every parsed row (capped at the 5,000 import limit) so the commit
    // step imports the whole file — the preview UI only renders the first row.
    return NextResponse.json({
      headers,
      ourFields,
      suggestedMapping: suggested,
      rows: rows.slice(0, 5000),
      total: rows.length,
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}
