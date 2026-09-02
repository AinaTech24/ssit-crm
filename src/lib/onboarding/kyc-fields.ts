/**
 * Per-client-type KYC DATA-FIELD checklists for the public document link (/d/<token>).
 *
 * The public onboarding page collects two things from the client:
 *   1. Documents  (see doc-checklists.ts)
 *   2. KYC data fields  (this file)
 *
 * The field set mirrors what the three MF transaction platforms actually
 * require to register a client and open the account:
 *   • BSE StAR MF — UCC (Unique Client Code) creation
 *   • NSE NMF II  — client registration
 *   • MFU         — eCAN (Common Account Number)
 * i.e. the SEBI/AMFI CKYC + KRA-KYC fields PLUS the platform-mandatory ones:
 * tax status, holding nature, occupation, nationality, default bank account,
 * nominee OR explicit nomination opt-out (SEBI), FATCA/CRS (country of birth,
 * tax residence, TIN), PEP, communication mode, and second/joint holder —
 * varied by client type (individual / minor / NRI / HUF / company / trust).
 *
 * When the client submits, `mapKycFieldsToInvestorUpdate()` translates the
 * collected values into a partial `investors` row so the data flows straight
 * into the **client master** — no manual re-keying. Any field without a
 * dedicated column is preserved verbatim in `investors.kyc_data` (and
 * `leads.kyc_data` until conversion), so nothing the client typed is lost.
 *
 * Field-set basis: CKYC/KRA-KYC Common Application Form (AMFI / CAMS-KRA).
 */

import type { ClientType } from "./doc-checklists";

export type KycFieldType = "text" | "tel" | "email" | "date" | "select" | "number";

export interface KycField {
  key: string;
  label: string;
  type: KycFieldType;
  section: string;
  required?: boolean;
  options?: string[];
  helpText?: string;
  placeholder?: string;
  /**
   * `true` → this is a technical / regulatory field the MFD or back-office
   * team fills (tax status, FATCA/CRS, PEP, UBO, nomination declaration,
   * communication mode). It is NOT shown on the public client link — only
   * plain details a customer can fill themselves are. The field stays in the
   * catalog so the back office can complete it later, and the mapper still
   * writes it into the client master if present.
   */
  backOffice?: boolean;
  /**
   * Conditional visibility — the field renders only when another field's
   * current value is one of `in`. Used so e.g. the joint-holder fields appear
   * only after "Joint / Anyone-or-Survivor" is picked, and nominee blocks 2/3
   * appear only after the client says how many nominees they have.
   */
  showIf?: { field: string; in: string[] };
}

/** Whether a field should render given the current form values. */
export function isFieldVisible(field: KycField, values: Record<string, string>): boolean {
  if (!field.showIf) return true;
  const cur = String(values[field.showIf.field] ?? "").trim();
  return field.showIf.in.includes(cur);
}

/**
 * When 2+ nominees are declared with shares, they must total 100%. Returns an
 * error string for the form, or null when fine (single nominee / no shares).
 */
export function validateNomineeAllocations(values: Record<string, string>): string | null {
  const count = parseInt(values["nominee_count"] || "0", 10);
  if (!count || count < 2) return null;
  let sum = 0;
  let any = false;
  for (let i = 1; i <= count; i++) {
    const a = String(values[`nominee_${i}_allocation`] ?? "").trim();
    if (a) {
      any = true;
      const n = parseFloat(a);
      if (!isNaN(n)) sum += n;
    }
  }
  if (any && Math.round(sum) !== 100) return `Nominee shares must total 100% (currently ${sum}%).`;
  return null;
}

/** Mark a whole group of fields as back-office (MFD-filled, hidden from client). */
const bo = (fields: KycField[]): KycField[] => fields.map((f) => ({ ...f, backOffice: true }));

// ─── Reusable option lists (CKYC code lists) ────────────────────────────────
const GENDER = ["Male", "Female", "Other"];
const MARITAL = ["Single", "Married", "Other"];
const OCCUPATION = [
  "Private Sector Service",
  "Public Sector Service",
  "Government Service",
  "Business",
  "Professional",
  "Self Employed",
  "Retired",
  "Housewife",
  "Student",
  "Agriculturist",
  "Doctor",
  "Forex Dealer",
  "Other",
];
const INCOME_RANGE = [
  "Below ₹1 Lakh",
  "₹1 - 5 Lakh",
  "₹5 - 10 Lakh",
  "₹10 - 25 Lakh",
  "₹25 Lakh - 1 Crore",
  "Above ₹1 Crore",
];
const RESIDENCY = [
  "Resident Individual",
  "Non-Resident Indian (NRI)",
  "Overseas Citizen of India (OCI)",
  "Person of Indian Origin (PIO)",
  "Foreign National",
];
const MODE_OF_HOLDING = ["Single", "Joint", "Anyone or Survivor"];
const ACCOUNT_TYPE = ["Savings", "Current", "NRE", "NRO", "FCNR"];
const RELATION = ["Self", "Spouse", "Son", "Daughter", "Father", "Mother", "Dependent", "Guardian", "Other"];
// Platform tax-status values (BSE StAR / NSE NMF / MFU client master).
const TAX_STATUS_INDIVIDUAL = [
  "Resident Individual",
  "Non-Resident Indian (NRI) - Repatriable",
  "Non-Resident Indian (NRI) - Non-Repatriable",
  "Minor",
  "HUF",
];
const TAX_STATUS_ENTITY = ["HUF", "Company / Body Corporate", "Trust", "Partnership Firm", "LLP", "AOP / BOI", "Society", "Other"];
const COMMUNICATION_MODE = ["Email / Digital", "Physical"];
const YES_NO = ["No", "Yes"];
const NOMINATION_CHOICE = [
  "Yes — I want to nominate (fill nominee details below)",
  "No — I do not wish to nominate",
];
const NOMINEE_COUNTS = ["1", "2", "3"];
const SOURCE_OF_WEALTH = [
  "Salary",
  "Business Income",
  "Investment / Capital Gains",
  "Inheritance / Ancestral",
  "Gift",
  "Rental Income",
  "Prize Money",
  "Other",
];
const PEP = ["Not a PEP", "I am a Politically Exposed Person (PEP)", "Related to a PEP"];

// ─── Field groups (composed per client type) ────────────────────────────────

/** Personal identity — individual / minor / NRI. */
const PERSONAL_INDIVIDUAL: KycField[] = [
  { key: "name_as_per_pan", label: "Full name (exactly as on PAN card)", type: "text", section: "Personal details", required: true },
  { key: "pan", label: "PAN", type: "text", section: "Personal details", required: true, placeholder: "ABCDE1234F", helpText: "10-character PAN (e.g. ABCDE1234F)" },
  { key: "dob", label: "Date of birth", type: "date", section: "Personal details", required: true },
  { key: "gender", label: "Gender", type: "select", section: "Personal details", required: true, options: GENDER },
  { key: "marital_status", label: "Marital status", type: "select", section: "Personal details", options: MARITAL },
  { key: "mother_name", label: "Mother's name", type: "text", section: "Personal details", helpText: "As per CKYC norms (mother's / father's / spouse's name)" },
  { key: "birth_place", label: "Place of birth", type: "text", section: "Personal details" },
  { key: "aadhaar", label: "Aadhaar number", type: "text", section: "Personal details", placeholder: "XXXX XXXX 1234", helpText: "Only the last 4 digits are stored on our system." },
];

const OCCUPATION_INCOME: KycField[] = [
  { key: "occupation", label: "Occupation", type: "select", section: "Occupation & income", required: true, options: OCCUPATION },
  { key: "income_range", label: "Annual income range", type: "select", section: "Occupation & income", required: true, options: INCOME_RANGE },
  { key: "source_of_wealth", label: "Source of wealth / funds", type: "select", section: "Occupation & income", options: SOURCE_OF_WEALTH, backOffice: true },
];

// Tax & residency — technical classification the MFD/back office assigns.
const TAX_RESIDENCY: KycField[] = bo([
  { key: "tax_status", label: "Tax status", type: "select", section: "Tax & residency", required: true, options: TAX_STATUS_INDIVIDUAL, helpText: "As registered with the AMC / RTA." },
  { key: "residency_status", label: "Residential status", type: "select", section: "Tax & residency", required: true, options: RESIDENCY },
  { key: "nationality", label: "Nationality", type: "text", section: "Tax & residency", required: true, placeholder: "Indian" },
]);

// FATCA / CRS — mandatory for BSE/NSE/MFU, but a compliance form the back
// office completes (not customer-friendly).
const FATCA: KycField[] = bo([
  { key: "country_of_birth", label: "Country of birth", type: "text", section: "FATCA / CRS declaration", placeholder: "India" },
  { key: "tax_resident_outside_india", label: "Are you a tax resident of any country other than India?", type: "select", section: "FATCA / CRS declaration", required: true, options: YES_NO },
  { key: "country_of_tax_residence", label: "If yes — country of tax residence", type: "text", section: "FATCA / CRS declaration", helpText: "Leave blank if you answered No." },
  { key: "tax_id_number", label: "If yes — Tax Identification Number (TIN)", type: "text", section: "FATCA / CRS declaration", helpText: "Leave blank if you answered No." },
  { key: "pep_status", label: "Politically Exposed Person (PEP) status", type: "select", section: "FATCA / CRS declaration", required: true, options: PEP },
]);

const CONTACT: KycField[] = [
  { key: "email", label: "Email address", type: "email", section: "Contact" },
  { key: "mobile", label: "Mobile number", type: "tel", section: "Contact", placeholder: "10-digit mobile" },
  { key: "mobile_relation", label: "Mobile / email belongs to", type: "select", section: "Contact", options: RELATION, backOffice: true },
];

const ADDRESS: KycField[] = [
  { key: "address_line1", label: "Address (house, street, area)", type: "text", section: "Correspondence address", required: true },
  { key: "address_city", label: "City", type: "text", section: "Correspondence address", required: true },
  { key: "address_state", label: "State", type: "text", section: "Correspondence address", required: true },
  { key: "address_pincode", label: "PIN code", type: "text", section: "Correspondence address", required: true, placeholder: "6-digit PIN" },
  { key: "address_country", label: "Country", type: "text", section: "Correspondence address", placeholder: "India" },
];

const BANK: KycField[] = [
  { key: "bank_name", label: "Bank name", type: "text", section: "Bank account (for redemptions)", required: true },
  { key: "bank_account_number", label: "Bank account number", type: "text", section: "Bank account (for redemptions)", required: true, helpText: "Only the last 4 digits are stored; used to verify redemption payouts." },
  { key: "bank_ifsc", label: "IFSC code", type: "text", section: "Bank account (for redemptions)", required: true, placeholder: "HDFC0001234" },
  { key: "bank_account_type", label: "Account type", type: "select", section: "Bank account (for redemptions)", options: ACCOUNT_TYPE },
];

// Holding nature — the client picks this; it drives whether the joint-holder
// fields below appear. Customer-facing (a plain Single/Joint choice).
const HOLDING_NATURE: KycField[] = [
  { key: "mode_of_holding", label: "Mode of holding", type: "select", section: "Folio & holding", required: true, options: MODE_OF_HOLDING, helpText: "Single, or held jointly with others." },
];

// Statement dispatch mode — back office configures this.
const COMMS_PREF: KycField[] = bo([
  { key: "communication_mode", label: "Receive statements / communication via", type: "select", section: "Folio & holding", options: COMMUNICATION_MODE },
]);

// Joint holders — revealed ONLY when the folio is jointly held. Up to two
// extra holders (platforms allow three holders total).
const JOINT_COND = { field: "mode_of_holding", in: ["Joint", "Anyone or Survivor"] };
const JOINT_HOLDER: KycField[] = [
  { key: "second_holder_name", label: "Second holder full name", type: "text", section: "Joint holders", showIf: JOINT_COND },
  { key: "second_holder_pan", label: "Second holder PAN", type: "text", section: "Joint holders", placeholder: "ABCDE1234F", showIf: JOINT_COND },
  { key: "second_holder_dob", label: "Second holder date of birth", type: "date", section: "Joint holders", showIf: JOINT_COND },
  { key: "third_holder_name", label: "Third holder full name (optional)", type: "text", section: "Joint holders", showIf: JOINT_COND },
  { key: "third_holder_pan", label: "Third holder PAN (optional)", type: "text", section: "Joint holders", placeholder: "ABCDE1234F", showIf: JOINT_COND },
  { key: "third_holder_dob", label: "Third holder date of birth (optional)", type: "date", section: "Joint holders", showIf: JOINT_COND },
];

// Nominees — the client says how many (1–3) and each block opens accordingly,
// each with a % share. The formal nominate/opt-out DECLARATION stays
// back-office.
function nomineeBlock(i: number): KycField[] {
  const ord = i === 1 ? "First" : i === 2 ? "Second" : "Third";
  const showIf = { field: "nominee_count", in: NOMINEE_COUNTS.slice(i - 1) }; // block i shows when count >= i
  return [
    { key: `nominee_${i}_name`, label: `${ord} nominee — name`, type: "text", section: "Nominee", showIf },
    { key: `nominee_${i}_relation`, label: "Relationship", type: "select", section: "Nominee", options: RELATION, showIf },
    { key: `nominee_${i}_dob`, label: "Date of birth", type: "date", section: "Nominee", showIf },
    { key: `nominee_${i}_allocation`, label: "Share %", type: "number", section: "Nominee", showIf, helpText: i === 1 ? "All nominees' shares must total 100%." : undefined },
  ];
}
const NOMINEE: KycField[] = [
  { key: "nomination_choice", label: "Nomination", type: "select", section: "Nominee", required: true, options: NOMINATION_CHOICE, backOffice: true },
  { key: "nominee_count", label: "How many nominees would you like to add?", type: "select", section: "Nominee", options: NOMINEE_COUNTS, helpText: "You can add up to 3 nominees with a % share each." },
  ...nomineeBlock(1),
  ...nomineeBlock(2),
  ...nomineeBlock(3),
];

// NRI-specific extras
const NRI_EXTRA: KycField[] = [
  { key: "country_of_residence", label: "Country of residence", type: "text", section: "Tax & residency", required: true },
  { key: "overseas_address", label: "Overseas address", type: "text", section: "Correspondence address", required: true },
];

// Minor-specific guardian section
const GUARDIAN: KycField[] = [
  { key: "guardian_name", label: "Guardian's full name", type: "text", section: "Guardian details", required: true },
  { key: "guardian_pan", label: "Guardian's PAN", type: "text", section: "Guardian details", required: true, placeholder: "ABCDE1234F" },
  { key: "guardian_relationship", label: "Guardian's relationship to minor", type: "select", section: "Guardian details", required: true, options: ["Father", "Mother", "Court-appointed Guardian", "Other"] },
];

// Entity (HUF / company / trust) field sets — entity-level, with the
// platform-mandatory tax status, FATCA/UBO, nomination and bank details.
function entityFields(entityLabel: string, opts?: { authorisedLabel?: string; taxStatusDefault?: string }): KycField[] {
  const authLabel = opts?.authorisedLabel ?? "Authorised signatory";
  const taxOptions = opts?.taxStatusDefault
    ? [opts.taxStatusDefault, ...TAX_STATUS_ENTITY.filter((o) => o !== opts.taxStatusDefault)]
    : TAX_STATUS_ENTITY;
  return [
    { key: "name_as_per_pan", label: `${entityLabel} name (as per PAN)`, type: "text", section: "Entity details", required: true },
    { key: "pan", label: `${entityLabel} PAN`, type: "text", section: "Entity details", required: true, placeholder: "ABCDE1234F" },
    { key: "tax_status", label: "Tax status", type: "select", section: "Entity details", required: true, options: taxOptions, backOffice: true },
    { key: "date_of_incorporation", label: "Date of incorporation / registration", type: "date", section: "Entity details" },
    { key: "place_of_registration", label: "Place of registration", type: "text", section: "Entity details" },
    { key: "nationality", label: "Country of incorporation", type: "text", section: "Entity details", placeholder: "India", backOffice: true },
    { key: "authorised_person_name", label: `${authLabel} name`, type: "text", section: "Authorised person", required: true },
    { key: "authorised_person_pan", label: `${authLabel} PAN`, type: "text", section: "Authorised person", placeholder: "ABCDE1234F" },
    { key: "email", label: "Email address", type: "email", section: "Contact" },
    { key: "mobile", label: "Mobile number", type: "tel", section: "Contact" },
    ...ADDRESS,
    { key: "occupation", label: "Nature of business", type: "text", section: "Occupation & income" },
    { key: "income_range", label: "Annual turnover / income range", type: "select", section: "Occupation & income", options: INCOME_RANGE },
    // FATCA / UBO — mandatory for non-individual clients on BSE/NSE/MFU, but a
    // compliance form the back office completes.
    ...bo([
      { key: "tax_resident_outside_india", label: "Is the entity a tax resident outside India?", type: "select", section: "FATCA / CRS / UBO", required: true, options: YES_NO },
      { key: "country_of_tax_residence", label: "If yes — country of tax residence", type: "text", section: "FATCA / CRS / UBO" },
      { key: "tax_id_number", label: "If yes — Tax Identification Number (TIN) / GIIN", type: "text", section: "FATCA / CRS / UBO" },
      { key: "ubo_name", label: "Ultimate Beneficial Owner (UBO) name", type: "text", section: "FATCA / CRS / UBO", helpText: "Person(s) holding >10% / controlling the entity." },
      { key: "ubo_pan", label: "UBO PAN", type: "text", section: "FATCA / CRS / UBO", placeholder: "ABCDE1234F" },
    ]),
    ...BANK,
    { key: "communication_mode", label: "Receive statements / communication via", type: "select", section: "Folio preferences", options: COMMUNICATION_MODE, backOffice: true },
    { key: "nomination_choice", label: "Nomination", type: "select", section: "Nominee", options: ["Not applicable (non-individual)", "Yes — nominee details below"], backOffice: true },
    { key: "nominee_name", label: "Nominee name", type: "text", section: "Nominee" },
    { key: "nominee_relation", label: "Relationship with nominee", type: "select", section: "Nominee", options: RELATION },
  ];
}

// ─── The checklists ─────────────────────────────────────────────────────────
export const FIELD_CHECKLISTS: Record<ClientType, KycField[]> = {
  individual: [
    ...PERSONAL_INDIVIDUAL,
    ...OCCUPATION_INCOME,
    ...TAX_RESIDENCY,
    ...FATCA,
    ...CONTACT,
    ...ADDRESS,
    ...BANK,
    ...HOLDING_NATURE,
    ...JOINT_HOLDER,
    ...COMMS_PREF,
    ...NOMINEE,
  ],
  minor: [
    ...PERSONAL_INDIVIDUAL.map((f) =>
      f.key === "pan" ? { ...f, label: "Minor's PAN (if available)", required: false } : f
    ),
    ...GUARDIAN,
    ...OCCUPATION_INCOME.filter((f) => f.key !== "occupation"),
    ...TAX_RESIDENCY.map((f) => (f.key === "tax_status" ? { ...f, options: ["Minor"] } : f)),
    ...FATCA,
    ...CONTACT,
    ...ADDRESS,
    ...BANK,
    // Minor folios are always single-held by the guardian — no holding-nature
    // choice / joint holders.
    ...COMMS_PREF,
    ...NOMINEE,
  ],
  nri: [
    ...PERSONAL_INDIVIDUAL.map((f) =>
      f.key === "aadhaar" ? { ...f, required: false } : f
    ),
    ...OCCUPATION_INCOME,
    ...TAX_RESIDENCY.map((f) =>
      f.key === "tax_status"
        ? { ...f, options: ["Non-Resident Indian (NRI) - Repatriable", "Non-Resident Indian (NRI) - Non-Repatriable"] }
        : f.key === "residency_status"
          ? { ...f, options: RESIDENCY.filter((o) => o !== "Resident Individual") }
          : f
    ),
    ...NRI_EXTRA,
    ...FATCA,
    ...CONTACT,
    ...ADDRESS,
    ...BANK.map((f) =>
      f.key === "bank_account_type" ? { ...f, options: ["NRE", "NRO", "FCNR"] } : f
    ),
    ...HOLDING_NATURE,
    ...JOINT_HOLDER,
    ...COMMS_PREF,
    ...NOMINEE,
  ],
  huf: entityFields("HUF", { authorisedLabel: "Karta", taxStatusDefault: "HUF" }),
  company: entityFields("Company", { authorisedLabel: "Authorised signatory", taxStatusDefault: "Company / Body Corporate" }),
  trust: entityFields("Trust", { authorisedLabel: "Authorised trustee", taxStatusDefault: "Trust" }),
};

/** Every field for a client type (client-facing + back-office). */
export function getAllFields(clientType: ClientType): KycField[] {
  return FIELD_CHECKLISTS[clientType] ?? FIELD_CHECKLISTS.individual;
}

/**
 * Client-facing fields only — the plain details a normal customer can fill
 * themselves. This is what the public onboarding link (/d/<token>) shows.
 * Technical / regulatory fields (`backOffice: true`) are excluded; the MFD or
 * back office completes those in the client master.
 */
export function getFieldChecklist(clientType: ClientType): KycField[] {
  return getAllFields(clientType).filter((f) => !f.backOffice);
}

/** Back-office fields only — for the MFD / ops team to complete in-app. */
export function getBackOfficeFields(clientType: ClientType): KycField[] {
  return getAllFields(clientType).filter((f) => f.backOffice);
}

/**
 * Every distinct field across ALL client types, deduped by key (first wins).
 * Powers the admin "which fields are mandatory" settings screen — the required
 * override is keyed on the field key, so it applies wherever that field appears.
 */
export function getAllUniqueFields(): KycField[] {
  const seen = new Set<string>();
  const out: KycField[] = [];
  for (const list of Object.values(FIELD_CHECKLISTS)) {
    for (const f of list) {
      if (seen.has(f.key)) continue;
      seen.add(f.key);
      out.push(f);
    }
  }
  return out;
}

/**
 * Apply a per-tenant required-override map onto a field list. The map is
 * { fieldKey: boolean } — a key set to true makes the field mandatory, false
 * makes it optional; an absent key keeps the catalog default. Used so a firm can
 * decide which onboarding fields its team MUST fill.
 */
export function applyRequiredOverrides(
  fields: KycField[],
  overrides: Record<string, boolean> | null | undefined
): KycField[] {
  if (!overrides || Object.keys(overrides).length === 0) return fields;
  return fields.map((f) => (f.key in overrides ? { ...f, required: !!overrides[f.key] } : f));
}

// ─── Client-master mapper ───────────────────────────────────────────────────

type InvestorMergeBase = {
  pan?: string | null;
  email?: string | null;
  phone?: string | null;
  whatsappPhone?: string | null;
  address?: { line1?: string; city?: string; state?: string; pincode?: string; country?: string } | null;
  bankAccounts?: Array<{ bankName?: string; accountMasked?: string; ifsc?: string; accountType?: string }> | null;
  nominees?: Array<{ name: string; relation?: string; dob?: string; sharePct?: number }> | null;
};

/**
 * Translate collected KYC field values into a partial `investors` update.
 * Only non-empty values produce columns. JSONB columns (address, bank,
 * nominees) are merged onto whatever already exists. Contact (email/phone) is
 * filled only when currently empty so a verified contact is never clobbered.
 *
 * The full raw `values` map should additionally be stored in
 * `investors.kyc_data` by the caller so unmapped fields (guardian, overseas
 * address, TIN, entity registration, …) are never lost.
 */
export function mapKycFieldsToInvestorUpdate(
  values: Record<string, string>,
  existing?: InvestorMergeBase
): Record<string, any> {
  const v = (k: string) => String(values[k] ?? "").trim();
  const set: Record<string, any> = {};

  if (v("name_as_per_pan")) set.nameAsPerPan = v("name_as_per_pan");

  // PAN — fill only when the master has none; validate the canonical shape.
  const pan = v("pan").toUpperCase();
  if (pan && /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan) && !existing?.pan) set.pan = pan;

  if (v("dob")) set.dob = v("dob"); // `date` column accepts a YYYY-MM-DD string
  if (v("gender")) {
    const g = v("gender").toLowerCase();
    set.gender = g.startsWith("m") ? "M" : g.startsWith("f") ? "F" : "O";
  }
  if (v("marital_status")) set.maritalStatus = v("marital_status");
  if (v("mother_name")) set.motherName = v("mother_name");
  if (v("birth_place")) set.birthPlace = v("birth_place");
  if (v("occupation")) set.occupation = v("occupation");
  if (v("income_range")) set.incomeRange = v("income_range");
  if (v("mode_of_holding")) set.modeOfHolding = v("mode_of_holding");
  if (v("mobile_relation")) set.mobileRelation = v("mobile_relation");

  if (v("residency_status")) {
    const r = v("residency_status").toLowerCase();
    set.residencyStatus = r.includes("oci")
      ? "oci"
      : r.includes("pio")
        ? "pio"
        : r.includes("foreign")
          ? "foreign_national"
          : r.includes("nri") || r.includes("non-resident") || r.includes("non resident")
            ? "nri"
            : "indian_resident";
  }
  // Tax status — the explicit platform field wins; else fall back to residency.
  if (v("tax_status")) set.taxStatus = v("tax_status");
  else if (v("residency_status")) set.taxStatus = v("residency_status");

  // Second / joint holder — split the full name into the client-master columns.
  const sh = v("second_holder_name");
  if (sh) {
    const parts = sh.split(/\s+/);
    set.secondHolderFirstName = parts[0];
    if (parts.length > 1) set.secondHolderLastName = parts.slice(1).join(" ");
  }

  if (v("aadhaar")) {
    const digits = v("aadhaar").replace(/\D/g, "");
    if (digits.length >= 4) set.aadhaarLast4 = digits.slice(-4);
  }

  // Contact — fill only when missing.
  if (v("email") && !existing?.email) set.email = v("email");
  if (v("mobile") && !existing?.phone) set.phone = v("mobile");

  // Correspondence address — merge.
  const addr: any = { ...(existing?.address ?? {}) };
  let addrTouched = false;
  if (v("address_line1")) { addr.line1 = v("address_line1"); addrTouched = true; }
  if (v("address_city")) { addr.city = v("address_city"); addrTouched = true; }
  if (v("address_state")) { addr.state = v("address_state"); addrTouched = true; }
  if (v("address_pincode")) { addr.pincode = v("address_pincode"); addrTouched = true; }
  if (v("address_country")) { addr.country = v("address_country"); addrTouched = true; }
  if (addrTouched) set.address = addr;

  // Bank — store masked account only; mirror into bankAccounts[0].
  const bankName = v("bank_name");
  const ifsc = v("bank_ifsc").toUpperCase();
  const acct = v("bank_account_number").replace(/\s/g, "");
  const acctType = v("bank_account_type");
  let masked: string | undefined;
  if (bankName) set.bankName = bankName;
  if (ifsc) set.bankIfsc = ifsc;
  if (acct) {
    masked = "••••" + acct.slice(-4);
    set.bankAccountNumberMasked = masked;
  }
  if (bankName || ifsc || acct || acctType) {
    const first: any = { ...(existing?.bankAccounts?.[0] ?? {}) };
    if (bankName) first.bankName = bankName;
    if (masked) first.accountMasked = masked;
    if (ifsc) first.ifsc = ifsc;
    if (acctType) first.accountType = acctType;
    const rest = (existing?.bankAccounts ?? []).slice(1);
    set.bankAccounts = [first, ...rest];
  }

  // Nominees — supports multiple (nominee_<i>_*) with a % share, and falls
  // back to the legacy single nominee_* fields. The full list replaces the
  // stored nominees (a submission is authoritative for nomination).
  const count = parseInt(v("nominee_count") || "0", 10);
  const built: { name: string; relation?: string; dob?: string; sharePct?: number }[] = [];
  const maxBlocks = count > 0 ? count : 3;
  for (let i = 1; i <= maxBlocks; i++) {
    const nm = v(`nominee_${i}_name`);
    if (!nm) continue;
    const e: { name: string; relation?: string; dob?: string; sharePct?: number } = { name: nm };
    const rel = v(`nominee_${i}_relation`);
    const dob = v(`nominee_${i}_dob`);
    const alloc = v(`nominee_${i}_allocation`);
    if (rel) e.relation = rel;
    if (dob) e.dob = dob;
    if (alloc) {
      const n = parseFloat(alloc);
      if (!isNaN(n)) e.sharePct = n;
    }
    built.push(e);
  }
  // Legacy single-nominee fallback (older links / entity forms).
  if (built.length === 0) {
    const nomName = v("nominee_name");
    if (nomName) {
      const e: { name: string; relation?: string; dob?: string } = { name: nomName };
      const rel = v("nominee_relation");
      const dob = v("nominee_dob");
      if (rel) e.relation = rel;
      if (dob) e.dob = dob;
      built.push(e);
    }
  }
  if (built.length > 0) {
    set.nominees = built;
    set.nomineeName = built[0].name;
    if (built[0].relation) set.nomineeRelation = built[0].relation;
    if (built[0].dob) set.nomineeDob = built[0].dob;
  }

  return set;
}
