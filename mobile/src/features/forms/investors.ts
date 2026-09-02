/**
 * Investor create form — field-for-field parity with the web
 * /dashboard/investors/new page. Same sections, same options, same POST body
 * to /api/investors, same family-linking side effect + redirect.
 */

import type { FormSpec } from "./types";

const u = (v: string) => (v?.trim() ? v.trim() : undefined);
const num = (v: string) => {
  const n = parseFloat(String(v));
  return isNaN(n) ? undefined : n;
};

export const investorForm: FormSpec = {
  title: "Add investor",
  endpoint: "/api/investors",
  submitLabel: "Create investor",
  invalidate: ["investors"],

  initial: (params) => ({
    name: "",
    pan: "",
    dob: "",
    gender: "",
    birthPlace: "",
    motherName: "",
    maritalStatus: "",
    occupation: "",
    employerName: "",
    aadhaarLast4: "",
    email: "",
    emailRelation: "",
    phone: "",
    mobileRelation: "",
    whatsappPhone: "",
    street: "",
    city: "",
    state: "",
    pincode: "",
    country: "India",
    householdType: "",
    familyOwnerName: "",
    investorCategory: "individual",
    segmentTag: "Retail",
    clientCategory: "",
    referralClientName: "",
    modeOfHolding: "",
    bseUccCode: "",
    taxStatus: "",
    residencyStatus: "",
    kycStatus: "pending",
    secondHolderFirstName: "",
    secondHolderLastName: "",
    secondHolderOccupation: "",
    secondHolderCompanyName: "",
    secondHolderBirthPlace: "",
    secondHolderMotherName: "",
    secondHolderMaritalStatus: "",
    nominees: [],
    referrals: [],
    rmId: "",
    onboardedAt: "",
    anniversaryDate: "",
    lastReviewAt: "",
    nextReviewAt: "",
    reviewFrequency: "",
    notes: "",
    // Edit-only fields (hidden in create via section visibleIf on `_edit`).
    _edit: "",
    alternatePhone: "",
    status: "",
    serviceTier: "",
    riskProfile: "",
    mandateStatus: "",
    mandateRefNo: "",
    nseCanCode: "",
    nameAsPerPan: "",
    panAadhaarLinkStatus: "",
    ckycNumber: "",
    ckycExpiryAt: "",
    kycValidatedAt: "",
    bankAccounts: [],
    _familyId: params.familyId ?? "",
  }),

  // Next meeting date = last meeting date + review frequency (auto-derived).
  derive: (v) => {
    const months: Record<string, number> = { monthly: 1, quarterly: 3, half_yearly: 6, annual: 12 };
    const m = months[v.reviewFrequency];
    if (v.lastReviewAt && m) {
      const d = new Date(v.lastReviewAt + "T00:00:00");
      if (!isNaN(d.getTime())) {
        d.setMonth(d.getMonth() + m);
        const next = d.toISOString().slice(0, 10);
        if (v.nextReviewAt !== next) return { nextReviewAt: next };
      }
    }
    return null;
  },

  validate: (v) => {
    const e: Record<string, string> = {};
    if (!v.name?.trim()) e.name = "Full name is required";
    if (!v.pan?.trim()) e.pan = "PAN card no is required";
    return Object.keys(e).length ? e : null;
  },

  sections: [
    {
      title: "Identity & personal",
      fields: [
        { key: "name", label: "Full name", required: true },
        { key: "pan", label: "PAN card no", required: true, placeholder: "ABCDE1234F", autoCapitalize: "characters", transform: (v) => v.toUpperCase() },
        { key: "dob", label: "Date of birth", type: "date", maxToday: true },
        { key: "gender", label: "Gender", type: "select", options: [{ value: "", label: "Select" }, { value: "M", label: "Male" }, { value: "F", label: "Female" }, { value: "O", label: "Other" }] },
        { key: "birthPlace", label: "Birth place" },
        { key: "motherName", label: "Mother's name" },
        { key: "maritalStatus", label: "Marital status", type: "select", options: ["", "Single", "Married", "Divorced", "Widowed"] },
        { key: "occupation", label: "Profession" },
        { key: "employerName", label: "Company name" },
        { key: "aadhaarLast4", label: "Aadhaar card (last 4)", keyboard: "number-pad" as any, placeholder: "last 4 digits only", transform: (v) => v.replace(/\D/g, "").slice(0, 4) },
      ],
    },
    {
      title: "Contact",
      fields: [
        { key: "email", label: "Email", type: "email" },
        { key: "emailRelation", label: "Email relation", placeholder: "self / spouse / …" },
        { key: "phone", label: "Mobile", type: "tel", placeholder: "+919XXXXXXXXX" },
        { key: "mobileRelation", label: "Mobile relation", placeholder: "self / spouse / …" },
        { key: "whatsappPhone", label: "WhatsApp", type: "tel", placeholder: "Same as mobile if blank" },
      ],
    },
    {
      title: "Mailing address",
      fields: [
        { key: "street", label: "Mailing street", placeholder: "House / building, street, area" },
        { key: "city", label: "City" },
        { key: "state", label: "State" },
        { key: "pincode", label: "Zip", keyboard: "number-pad" as any },
        { key: "country", label: "Country" },
      ],
    },
    {
      title: "Classification & compliance",
      fields: [
        { key: "householdType", label: "Family or individual", type: "select", options: ["", "Individual", "Family"] },
        { key: "familyOwnerName", label: "Family owner", placeholder: "head of family (if part of one)" },
        { key: "investorCategory", label: "Category", type: "select", options: ["individual", "huf", "corporate", "trust", "nri", "minor", "other"] },
        { key: "segmentTag", label: "Segment", type: "select", options: ["HNI", "Affluent", "Retail", "NRI", "Corporate"] },
        { key: "clientCategory", label: "Client category", type: "select", options: [{ value: "", label: "Select" }, { value: "A", label: "A" }, { value: "B", label: "B" }, { value: "C", label: "C" }, { value: "D", label: "D" }] },
        { key: "referralClientName", label: "Referral client name" },
        { key: "modeOfHolding", label: "Mode of holding", type: "select", options: ["", "Single", "Joint", "Anyone or Survivor"] },
        { key: "bseUccCode", label: "UCC no" },
        { key: "taxStatus", label: "Tax status", placeholder: "e.g. Resident Individual" },
        { key: "residencyStatus", label: "Residential status", type: "select", options: [{ value: "", label: "Select" }, { value: "indian_resident", label: "Indian resident" }, { value: "nri", label: "NRI" }, { value: "oci", label: "OCI" }, { value: "pio", label: "PIO" }, { value: "foreign_national", label: "Foreign national" }] },
        { key: "kycStatus", label: "KYC status", type: "select", options: [{ value: "pending", label: "Pending" }, { value: "registered", label: "Registered" }, { value: "verified", label: "Verified" }, { value: "hold", label: "Hold" }, { value: "rejected", label: "Rejected" }, { value: "expired", label: "Expired" }, { value: "re_kyc_required", label: "Re-KYC required" }] },
      ],
    },
    {
      title: "Second / joint holder (optional)",
      fields: [
        { key: "secondHolderFirstName", label: "First name" },
        { key: "secondHolderLastName", label: "Last name" },
        { key: "secondHolderOccupation", label: "Occupation" },
        { key: "secondHolderCompanyName", label: "Company name" },
        { key: "secondHolderBirthPlace", label: "Birth place" },
        { key: "secondHolderMotherName", label: "Mother's name" },
        { key: "secondHolderMaritalStatus", label: "Marital status", type: "select", options: ["", "Single", "Married", "Divorced", "Widowed"] },
      ],
    },
    {
      title: "Nominees",
      fields: [
        {
          key: "nominees",
          label: "Nominees",
          type: "repeater",
          addLabel: "Add nominee",
          itemTitle: (n, i) => n.name?.trim() || `Nominee ${i + 1}`,
          itemFields: [
            { key: "name", label: "Name" },
            { key: "relation", label: "Relation", placeholder: "Spouse / Son / …" },
            { key: "dob", label: "Date of birth", type: "date", maxToday: true },
            { key: "mobile", label: "Mobile", type: "tel" },
            { key: "pan", label: "PAN", autoCapitalize: "characters", transform: (v) => v.toUpperCase() },
            { key: "sharePct", label: "Share %", type: "number" },
          ],
        },
      ],
    },
    {
      title: "Referrals",
      fields: [
        {
          key: "referrals",
          label: "Referrals",
          type: "repeater",
          addLabel: "Add referral",
          itemTitle: (r, i) => r.name?.trim() || `Referral ${i + 1}`,
          itemFields: [
            { key: "name", label: "Name" },
            { key: "relation", label: "Relation", placeholder: "Friend / Family / Colleague" },
            { key: "mobile", label: "Mobile", type: "tel" },
            { key: "email", label: "Email", type: "email" },
            { key: "note", label: "Note", type: "textarea" },
          ],
        },
      ],
    },
    {
      title: "Relationship & review",
      fields: [
        {
          key: "rmId",
          label: "Assigned RM",
          type: "lookup",
          lookupEndpoint: "/api/employees?role=rm",
          lookupEnvelope: "rows",
          lookupLabel: (e) => e.name + (Array.isArray(e.roles) && e.roles.length ? ` · ${e.roles[0]}` : ""),
          placeholder: "— Use firm default (owner) —",
          clearable: true,
          help: "optional — defaults to the firm owner",
        },
        { key: "onboardedAt", label: "Date of onboarding", type: "date", maxToday: true },
        { key: "anniversaryDate", label: "Anniversary date", type: "date", maxToday: true },
        { key: "lastReviewAt", label: "Last meeting date", type: "date", maxToday: true },
        { key: "nextReviewAt", label: "Next meeting date", type: "date" },
        { key: "reviewFrequency", label: "Review frequency", type: "select", options: [{ value: "", label: "Select" }, { value: "monthly", label: "Monthly" }, { value: "quarterly", label: "Quarterly" }, { value: "half_yearly", label: "Half-yearly" }, { value: "annual", label: "Annual" }] },
      ],
    },
    {
      // Edit-only — mirrors the web MasterRecordEditor's status/tier/risk block.
      title: "Status & lifecycle",
      visibleIf: (v) => v._edit === "1",
      fields: [
        { key: "status", label: "Client status", type: "select", options: [{ value: "active", label: "Active" }, { value: "dormant", label: "Dormant" }, { value: "inactive", label: "Inactive" }, { value: "redemption_risk", label: "Redemption risk" }, { value: "closed", label: "Closed" }, { value: "exited", label: "Exited" }] },
        { key: "serviceTier", label: "Service tier", type: "select", options: [{ value: "", label: "—" }, { value: "A", label: "A — Quarterly" }, { value: "B", label: "B — Half-yearly" }, { value: "C", label: "C — Annual" }] },
        { key: "riskProfile", label: "Risk profile", type: "select", options: [{ value: "", label: "Not assessed" }, { value: "conservative", label: "Conservative" }, { value: "moderate", label: "Moderate" }, { value: "aggressive", label: "Aggressive" }, { value: "very_aggressive", label: "Very aggressive" }] },
        { key: "alternatePhone", label: "Alternate mobile", type: "tel" },
        { key: "mandateStatus", label: "Mandate status", type: "select", options: [{ value: "", label: "—" }, { value: "none", label: "None" }, { value: "pending", label: "Pending" }, { value: "active", label: "Active" }, { value: "expired", label: "Expired" }, { value: "rejected", label: "Rejected" }, { value: "cancelled", label: "Cancelled" }] },
        { key: "mandateRefNo", label: "Mandate ref no" },
        { key: "nseCanCode", label: "NSE CAN" },
      ],
    },
    {
      // Edit-only — KYC tracker fields.
      title: "KYC tracker",
      visibleIf: (v) => v._edit === "1",
      fields: [
        { key: "nameAsPerPan", label: "Name as per PAN" },
        { key: "panAadhaarLinkStatus", label: "PAN–Aadhaar link", type: "select", options: [{ value: "", label: "—" }, { value: "linked", label: "Linked" }, { value: "not_linked", label: "Not linked" }, { value: "pending", label: "Pending" }, { value: "not_applicable", label: "Not applicable" }] },
        { key: "ckycNumber", label: "CKYC number" },
        { key: "ckycExpiryAt", label: "CKYC expiry", type: "date" },
        { key: "kycValidatedAt", label: "KYC validated on", type: "date", maxToday: true },
      ],
    },
    {
      // Edit-only — multi bank accounts (create form has none).
      title: "Bank accounts",
      visibleIf: (v) => v._edit === "1",
      fields: [
        {
          key: "bankAccounts",
          label: "Bank accounts",
          type: "repeater",
          addLabel: "Add bank account",
          itemTitle: (b, i) => b.bankName?.trim() || `Bank ${i + 1}`,
          itemFields: [
            { key: "bankName", label: "Bank name" },
            { key: "accountMasked", label: "Account number" },
            { key: "ifsc", label: "IFSC", autoCapitalize: "characters", transform: (v) => v.toUpperCase() },
          ],
        },
      ],
    },
    {
      title: "Notes",
      fields: [{ key: "notes", label: "Notes", type: "textarea" }],
    },
  ],

  buildBody: (form) => ({
    name: form.name,
    pan: form.pan.toUpperCase().trim(),
    dob: u(form.dob),
    gender: form.gender || undefined,
    birthPlace: u(form.birthPlace),
    motherName: u(form.motherName),
    maritalStatus: u(form.maritalStatus),
    occupation: u(form.occupation),
    employerName: u(form.employerName),
    aadhaarLast4: u(form.aadhaarLast4),
    email: u(form.email),
    emailRelation: u(form.emailRelation),
    phone: u(form.phone),
    mobileRelation: u(form.mobileRelation),
    whatsappPhone: form.whatsappPhone || form.phone || undefined,
    address: {
      line1: u(form.street),
      city: u(form.city),
      state: u(form.state),
      pincode: u(form.pincode),
      country: u(form.country),
    },
    investorCategory: form.investorCategory,
    segmentTag: form.segmentTag,
    clientCategory: form.clientCategory || undefined,
    householdType: u(form.householdType),
    familyOwnerName: u(form.familyOwnerName),
    referralClientName: u(form.referralClientName),
    modeOfHolding: u(form.modeOfHolding),
    bseUccCode: u(form.bseUccCode),
    taxStatus: u(form.taxStatus),
    residencyStatus: form.residencyStatus || undefined,
    kycStatus: form.kycStatus || undefined,
    secondHolderFirstName: u(form.secondHolderFirstName),
    secondHolderLastName: u(form.secondHolderLastName),
    secondHolderOccupation: u(form.secondHolderOccupation),
    secondHolderCompanyName: u(form.secondHolderCompanyName),
    secondHolderBirthPlace: u(form.secondHolderBirthPlace),
    secondHolderMotherName: u(form.secondHolderMotherName),
    secondHolderMaritalStatus: u(form.secondHolderMaritalStatus),
    rmId: form.rmId || undefined,
    nominees: (() => {
      const list = (form.nominees as any[])
        .map((n) => ({
          name: (n.name ?? "").trim(),
          relation: u(n.relation),
          dob: u(n.dob),
          mobile: u(n.mobile),
          pan: n.pan?.trim() ? n.pan.toUpperCase().trim() : undefined,
          sharePct: num(n.sharePct),
        }))
        .filter((n) => n.name);
      return list.length ? list : undefined;
    })(),
    referrals: (() => {
      const list = (form.referrals as any[])
        .map((r) => ({
          name: (r.name ?? "").trim(),
          relation: u(r.relation),
          mobile: u(r.mobile),
          email: u(r.email),
          note: u(r.note),
        }))
        .filter((r) => r.name);
      return list.length ? list : undefined;
    })(),
    onboardedAt: u(form.onboardedAt),
    anniversaryDate: u(form.anniversaryDate),
    lastReviewAt: u(form.lastReviewAt),
    nextReviewAt: u(form.nextReviewAt),
    reviewFrequency: form.reviewFrequency || undefined,
    notes: u(form.notes),
    // Edit-only fields — empty (hence undefined) on create, so they're omitted.
    alternatePhone: u(form.alternatePhone),
    status: form.status || undefined,
    serviceTier: form.serviceTier || undefined,
    riskProfile: form.riskProfile || undefined,
    mandateStatus: form.mandateStatus || undefined,
    mandateRefNo: u(form.mandateRefNo),
    nseCanCode: u(form.nseCanCode),
    nameAsPerPan: u(form.nameAsPerPan),
    panAadhaarLinkStatus: form.panAadhaarLinkStatus || undefined,
    ckycNumber: u(form.ckycNumber),
    ckycExpiryAt: u(form.ckycExpiryAt),
    kycValidatedAt: u(form.kycValidatedAt),
    bankAccounts: (() => {
      const list = ((form.bankAccounts as any[]) ?? [])
        .map((b) => ({
          bankName: (b.bankName ?? "").trim(),
          accountMasked: u(b.accountMasked),
          ifsc: b.ifsc?.trim() ? b.ifsc.toUpperCase().trim() : undefined,
        }))
        .filter((b) => b.bankName);
      return list.length ? list : undefined;
    })(),
  }),

  editTitle: "Edit client",
  editRecordEnvelope: "investor",
  editInitial: (rec) => {
    const dstr = (v: any) => (v ? String(v).slice(0, 10) : "");
    const addr = rec.address ?? {};
    const nominees = rec.nominees?.length
      ? rec.nominees
      : rec.nomineeName
        ? [{ name: rec.nomineeName, relation: rec.nomineeRelation ?? "", dob: dstr(rec.nomineeDob) }]
        : [];
    const bankAccounts = rec.bankAccounts?.length
      ? rec.bankAccounts
      : rec.bankName
        ? [{ bankName: rec.bankName, accountMasked: rec.bankAccountNumberMasked ?? "", ifsc: rec.bankIfsc ?? "" }]
        : [];
    return {
      _edit: "1",
      name: rec.name ?? "",
      pan: rec.pan ?? "",
      dob: dstr(rec.dob),
      gender: rec.gender ?? "",
      birthPlace: rec.birthPlace ?? "",
      motherName: rec.motherName ?? "",
      maritalStatus: rec.maritalStatus ?? "",
      occupation: rec.occupation ?? "",
      employerName: rec.employerName ?? "",
      aadhaarLast4: rec.aadhaarLast4 ?? "",
      email: rec.email ?? "",
      emailRelation: rec.emailRelation ?? "",
      phone: rec.phone ?? "",
      mobileRelation: rec.mobileRelation ?? "",
      whatsappPhone: rec.whatsappPhone ?? "",
      alternatePhone: rec.alternatePhone ?? "",
      street: addr.line1 ?? "",
      city: addr.city ?? "",
      state: addr.state ?? "",
      pincode: addr.pincode ?? "",
      country: addr.country ?? "India",
      householdType: rec.householdType ?? "",
      familyOwnerName: rec.familyOwnerName ?? "",
      investorCategory: rec.investorCategory ?? "individual",
      segmentTag: rec.segmentTag ?? "Retail",
      clientCategory: rec.clientCategory ?? "",
      referralClientName: rec.referralClientName ?? "",
      modeOfHolding: rec.modeOfHolding ?? "",
      bseUccCode: rec.bseUccCode ?? "",
      nseCanCode: rec.nseCanCode ?? "",
      taxStatus: rec.taxStatus ?? "",
      residencyStatus: rec.residencyStatus ?? "",
      kycStatus: rec.kycStatus ?? "pending",
      nameAsPerPan: rec.nameAsPerPan ?? "",
      panAadhaarLinkStatus: rec.panAadhaarLinkStatus ?? "",
      ckycNumber: rec.ckycNumber ?? "",
      ckycExpiryAt: dstr(rec.ckycExpiryAt),
      kycValidatedAt: dstr(rec.kycValidatedAt),
      status: rec.status ?? "active",
      serviceTier: rec.serviceTier ?? "",
      riskProfile: rec.riskProfile ?? "",
      mandateStatus: rec.mandateStatus ?? "",
      mandateRefNo: rec.mandateRefNo ?? "",
      secondHolderFirstName: rec.secondHolderFirstName ?? "",
      secondHolderLastName: rec.secondHolderLastName ?? "",
      secondHolderOccupation: rec.secondHolderOccupation ?? "",
      secondHolderCompanyName: rec.secondHolderCompanyName ?? "",
      secondHolderBirthPlace: rec.secondHolderBirthPlace ?? "",
      secondHolderMotherName: rec.secondHolderMotherName ?? "",
      secondHolderMaritalStatus: rec.secondHolderMaritalStatus ?? "",
      nominees,
      referrals: rec.referrals ?? [],
      bankAccounts,
      rmId: rec.rmId ?? "",
      onboardedAt: dstr(rec.onboardedAt),
      anniversaryDate: dstr(rec.anniversaryDate),
      lastReviewAt: dstr(rec.lastReviewAt),
      nextReviewAt: dstr(rec.nextReviewAt),
      reviewFrequency: rec.reviewFrequency ?? "",
      notes: rec.notes ?? "",
      _familyId: "",
    };
  },

  afterCreate: async (json, form, { router, params, post }) => {
    const familyId = params.familyId;
    if (familyId) {
      await post(`/api/families/${familyId}/members`, {
        investorId: json.id,
        familyRole: params.familyRole || undefined,
      });
      router.replace(`/m/families/${familyId}` as any);
    } else {
      router.replace(`/m/investors/${json.id}` as any);
    }
  },
};
